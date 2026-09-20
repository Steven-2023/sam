import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@openng/optimus-ui/dialog';
import { Button } from '@openng/optimus-ui/button';
import { MessageService } from '@openng/optimus-ui/api';
import { NgxExtendedPdfViewerModule, NgxExtendedPdfViewerService } from 'ngx-extended-pdf-viewer';
import { Tooltip } from '@openng/optimus-ui/tooltip';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TranslationService } from '../../../core/translation.service';
import { DocumentsApiService } from '../../../core/api/documents-api.service';
import { Attachment } from '../../../model/datamodels';
import { AnnotationSymbol, ARTICULATION_SYMBOLS, STRING_SYMBOLS, symbolToDataUrl } from './annotation-symbols';

interface PendingPlacement {
  symbol: AnnotationSymbol;
  pageIndex: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Minimal shape of pdf.js's PDFViewerApplication needed to read a page's PDF-point dimensions. */
interface PdfViewerApplication {
  pdfViewer?: {
    _pages?: Array<{ pdfPage?: { view?: [number, number, number, number] } }>;
  };
}

// Stamp size in on-screen CSS pixels (at the current zoom level), applied independently to width
// and height so the symbol renders as an actual square regardless of the page's aspect ratio.
// pdf.js's stamp editor silently enforces its own minimum box height (empirically ~21-22px) —
// requesting a percentage that maps to less than that made the editor grow the box from its
// top-left anchor instead of keeping it centered on the click, which is what made placed symbols
// come out both larger than requested AND visibly offset from the cursor-preview ghost. 26px
// clears that floor with a small margin while staying small enough to sit next to a notehead.
const SYMBOL_SIZE_PX = 26;

@Component({
  selector: 'app-pdf-annotation-editor',
  imports: [Dialog, Button, Tooltip, NgxExtendedPdfViewerModule, TranslatePipe],
  templateUrl: './pdf-annotation-editor.html',
  styleUrl: './pdf-annotation-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfAnnotationEditor {
  private readonly documentsApi = inject(DocumentsApiService);
  private readonly messageService = inject(MessageService);
  private readonly pdfViewerService = inject(NgxExtendedPdfViewerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly t = inject(TranslationService);

  readonly visible = input.required<boolean>();
  readonly basePath = input.required<string>();
  readonly attachment = input<Attachment | null>(null);

  readonly visibleChange = output<boolean>();
  readonly saved = output<Attachment>();

  protected readonly pdfSrc = signal<Blob | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  // [innerHTML] runs plain strings through Angular's sanitizer, which strips <svg> content
  // entirely — these SVGs are static, developer-authored (never user input), so trusting them
  // once here is safe and lets the icons actually render.
  protected readonly articulationSymbols = ARTICULATION_SYMBOLS.map((s) => this.toViewModel(s));
  protected readonly stringSymbols = STRING_SYMBOLS.map((s) => this.toViewModel(s));
  protected readonly armedSymbolId = signal<string | null>(null);
  protected readonly armedSymbol = computed(() => {
    const id = this.armedSymbolId();
    return id ? [...this.articulationSymbols, ...this.stringSymbols].find((s) => s.id === id) : undefined;
  });

  // Ghost copy of the armed symbol that follows the pointer over the PDF, so users can see exactly
  // where and how large it will land before clicking (mirrors forScore's stamp-placement UX).
  protected readonly cursorPreview = signal<{ x: number; y: number; sizePx: number } | null>(null);

  private readonly renderedEditorLayerPages = new Set<number>();
  private pendingPlacement: PendingPlacement | null = null;

  private toViewModel(symbol: AnnotationSymbol): AnnotationSymbol & { safeSvg: SafeHtml } {
    return { ...symbol, safeSvg: this.sanitizer.bypassSecurityTrustHtml(symbol.svg) };
  }

  constructor() {
    effect(() => {
      const attachment = this.attachment();
      if (this.visible() && attachment?.id) {
        this.loadPdf(this.basePath(), attachment.id);
      } else if (!this.visible()) {
        this.pdfSrc.set(null);
        this.armedSymbolId.set(null);
        this.cursorPreview.set(null);
        this.renderedEditorLayerPages.clear();
        this.pendingPlacement = null;
      }
    });

    // Registered on the capture phase (unlike @HostListener, which is bubble-only) so this runs
    // before the Optimus dialog's own Escape-to-close handler, letting us swallow the keystroke —
    // via stopPropagation, which a capture-phase call also blocks from ever reaching bubble-phase
    // listeners — when it should only disarm the symbol, not close the whole editor.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !this.armedSymbolId()) return;
      event.stopPropagation();
      this.armedSymbolId.set(null);
      this.cursorPreview.set(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    this.destroyRef.onDestroy(() => document.removeEventListener('keydown', onKeyDown, true));
  }

  protected armSymbol(symbol: AnnotationSymbol): void {
    const next = this.armedSymbolId() === symbol.id ? null : symbol.id;
    this.armedSymbolId.set(next);
    if (!next) this.cursorPreview.set(null);
  }

  protected isArmed(symbol: AnnotationSymbol): boolean {
    return this.armedSymbolId() === symbol.id;
  }

  protected onViewerMouseMove(event: MouseEvent): void {
    if (!this.armedSymbolId()) return;
    const container = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.cursorPreview.set({
      x: event.clientX - container.left,
      y: event.clientY - container.top,
      sizePx: SYMBOL_SIZE_PX,
    });
  }

  protected onViewerMouseLeave(): void {
    this.cursorPreview.set(null);
  }

  /**
   * Places the armed symbol as a real stamp annotation at the clicked spot. Bound to a (click) on
   * the wrapper around <ngx-extended-pdf-viewer> rather than pdf.js's own toolbar, since the
   * symbol set here (articulations, bowings) is specific to this app, not a generic pdf.js editor
   * mode. The symbol stays armed afterwards so several marks can be dropped in a row — see
   * onEscapePressed() and armSymbol() (click the same symbol again) for how to deselect it.
   */
  protected onViewerClick(event: MouseEvent): void {
    const armedId = this.armedSymbolId();
    if (!armedId) return;
    const symbol = [...this.articulationSymbols, ...this.stringSymbols].find((s) => s.id === armedId);
    const pageEl = (event.target as HTMLElement).closest('.page');
    if (!symbol || !pageEl) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = pageEl.getBoundingClientRect();
    // Screen/DOM percentages: 0% is the page's top/left edge, 100% is its bottom/right edge.
    const xDomPct = ((event.clientX - rect.left) / rect.width) * 100;
    const yDomPct = ((event.clientY - rect.top) / rect.height) * 100;
    const pageNumber = Number(pageEl.getAttribute('data-page-number'));

    // addImageToAnnotationLayer's top/bottom are PDF-native percentages (0% = the page's BOTTOM
    // edge, 100% = its top), the opposite orientation from screen/DOM percentages used above for
    // yDomPct — left/right don't need flipping since both coordinate systems agree on x.
    const halfWidthPct = (SYMBOL_SIZE_PX / rect.width / 2) * 100;
    const halfHeightPct = (SYMBOL_SIZE_PX / rect.height / 2) * 100;
    const placement: PendingPlacement = {
      symbol,
      pageIndex: pageNumber - 1,
      left: xDomPct - halfWidthPct,
      right: xDomPct + halfWidthPct,
      top: 100 - yDomPct + halfHeightPct,
      bottom: 100 - yDomPct - halfHeightPct,
    };
    if (this.renderedEditorLayerPages.has(pageNumber)) {
      this.placeSymbol(placement);
    } else {
      // The editor layer for this page hasn't rendered yet — addImageToAnnotationLayer would
      // silently no-op and log a warning if called now. onEditorLayerRendered() picks this back
      // up once the "annotationEditorLayerRendered" event fires for this exact page.
      this.pendingPlacement = placement;
    }
  }

  /** Bound to <ngx-extended-pdf-viewer>'s (annotationEditorLayerRendered) — see onViewerClick(). */
  protected onEditorLayerRendered(event: { pageNumber: number }): void {
    this.renderedEditorLayerPages.add(event.pageNumber);
    if (this.pendingPlacement && this.pendingPlacement.pageIndex + 1 === event.pageNumber) {
      const placement = this.pendingPlacement;
      this.pendingPlacement = null;
      this.placeSymbol(placement);
    }
  }

  private async placeSymbol(placement: PendingPlacement): Promise<void> {
    const { symbol, pageIndex, left, right, top, bottom } = placement;
    // addImageToAnnotationLayer's percentage parsing uses `Number.parseInt` on the string, which
    // truncates any decimal part instead of rounding — e.g. "43.68%" becomes 43. Since our
    // percentages are almost never whole numbers, that silently shifted every placement down and
    // to the left by up to ~1% of the page size (in each of left/right/top/bottom independently,
    // which also made stamps land at slightly inconsistent sizes from click to click). Converting
    // to exact PDF-point numbers ourselves bypasses that string parsing entirely — the library
    // uses a plain `number` argument as-is. Falls back to (rounded, to avoid the same truncation
    // bug on our own input) percentage strings if the page's PDF dimensions aren't reachable.
    const pdfDims = this.getPdfPageDimensions(pageIndex);
    const params = pdfDims
      ? {
          left: (left / 100) * pdfDims.width,
          right: (right / 100) * pdfDims.width,
          top: (top / 100) * pdfDims.height,
          bottom: (bottom / 100) * pdfDims.height,
        }
      : {
          left: `${Math.round(left)}%`,
          right: `${Math.round(right)}%`,
          top: `${Math.round(top)}%`,
          bottom: `${Math.round(bottom)}%`,
        };
    await this.pdfViewerService.addImageToAnnotationLayer({
      urlOrDataUrl: symbolToDataUrl(symbol),
      page: pageIndex,
      ...params,
    });
    // pdf.js leaves a just-placed stamp selected and resizable (the handles seen in the
    // screenshots) as if the insertion were still in progress — cosmetically unwanted, but
    // deliberately left alone: forcing a deselect here (either switchAnnotationEdtorMode() or the
    // AnnotationEditorUIManager's own unselectAll(), the same call pdf.js's Escape handler makes)
    // made EARLIER placements silently vanish from the document. Our stamps only ever get
    // inserted programmatically, never through a real user focus/blur cycle, so something in that
    // path doesn't durably commit them the way it does for interactively-drawn annotations —
    // exactly what and why wasn't pinned down. Losing marks the user placed is worse than leaving
    // the resize handles visible, so this stays as-is until that's understood.
  }

  /**
   * `NgxExtendedPdfViewerService.PDFViewerApplication` is marked `private` in the library's own
   * types (with no public alternative for reading a page's PDF-point dimensions), but it's a
   * normal runtime property — reading it is the only way to get exact, unrounded PDF coordinates
   * for placeSymbol()'s truncation workaround. Returns null if the page isn't loaded yet.
   */
  private getPdfPageDimensions(pageIndex: number): { width: number; height: number } | null {
    const app = (this.pdfViewerService as unknown as { PDFViewerApplication?: PdfViewerApplication })
      .PDFViewerApplication;
    const view = app?.pdfViewer?._pages?.[pageIndex]?.pdfPage?.view;
    if (!view) return null;
    const [x0, y0, x1, y1] = view;
    return { width: x1 - x0, height: y1 - y0 };
  }

  private loadPdf(basePath: string, attachmentId: string): void {
    this.loading.set(true);
    this.pdfSrc.set(null);
    this.documentsApi
      .download(basePath, attachmentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.pdfSrc.set(response.body);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.close();
        },
      });
  }

  protected save(): void {
    const attachment = this.attachment();
    if (!attachment?.id || this.saving()) return;

    this.saving.set(true);
    this.pdfViewerService.getCurrentDocumentAsBlob().then((blob) => {
      if (!blob) {
        this.saving.set(false);
        return;
      }
      this.documentsApi.replaceContent(attachment.id!, blob, attachment.displayName ?? 'annotated.pdf').subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.messageService.add({
            severity: 'success',
            summary: this.t.t('sheets.instrumentations.documents.annotationsSaved'),
          });
          this.saved.emit(updated);
          this.close();
        },
        error: () => {
          this.saving.set(false);
        },
      });
    });
  }

  protected close(): void {
    this.visibleChange.emit(false);
  }
}
