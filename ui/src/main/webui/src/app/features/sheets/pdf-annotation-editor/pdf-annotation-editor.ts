import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@openng/optimus-ui/dialog';
import { Button } from '@openng/optimus-ui/button';
import { MessageService } from '@openng/optimus-ui/api';
import { NgxExtendedPdfViewerModule, NgxExtendedPdfViewerService } from 'ngx-extended-pdf-viewer';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TranslationService } from '../../../core/translation.service';
import { DocumentsApiService } from '../../../core/api/documents-api.service';
import { Attachment } from '../../../model/datamodels';

@Component({
  selector: 'app-pdf-annotation-editor',
  imports: [Dialog, Button, NgxExtendedPdfViewerModule, TranslatePipe],
  templateUrl: './pdf-annotation-editor.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfAnnotationEditor {
  private readonly documentsApi = inject(DocumentsApiService);
  private readonly messageService = inject(MessageService);
  private readonly pdfViewerService = inject(NgxExtendedPdfViewerService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly t = inject(TranslationService);

  readonly visible = input.required<boolean>();
  readonly basePath = input.required<string>();
  readonly attachment = input<Attachment | null>(null);

  readonly visibleChange = output<boolean>();
  readonly saved = output<Attachment>();

  protected readonly pdfSrc = signal<Blob | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      const attachment = this.attachment();
      if (this.visible() && attachment?.id) {
        this.loadPdf(this.basePath(), attachment.id);
      } else if (!this.visible()) {
        this.pdfSrc.set(null);
      }
    });
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
