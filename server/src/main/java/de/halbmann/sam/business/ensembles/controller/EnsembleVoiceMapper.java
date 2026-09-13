package de.halbmann.sam.business.ensembles.controller;

import de.halbmann.sam.api.entity.ensembles.CreateEnsembleVoice;
import de.halbmann.sam.api.entity.ensembles.EnsembleVoice;
import de.halbmann.sam.business.ensembles.entity.EnsembleVoiceEntity;
import de.halbmann.sam.business.sheets.controller.VoiceOptionMapper;
import org.mapstruct.*;

@Mapper(
        componentModel = MappingConstants.ComponentModel.JAKARTA_CDI,
        uses = {VoiceOptionMapper.class},
        unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface EnsembleVoiceMapper {

    /** Default relative importance for a voice whose weight wasn't specified. */
    double DEFAULT_WEIGHT = 1.0;

    EnsembleVoice toDto(EnsembleVoiceEntity entity);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "version", ignore = true)
    @Mapping(target = "created", ignore = true)
    @Mapping(target = "lastUpdate", ignore = true)
    @Mapping(target = "ensemble", ignore = true)
    @Mapping(target = "options", ignore = true)
    @Mapping(target = "weight", expression = "java(dto.getWeight() != null ? dto.getWeight() : DEFAULT_WEIGHT)")
    EnsembleVoiceEntity fromDto(CreateEnsembleVoice dto);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "version", ignore = true)
    @Mapping(target = "created", ignore = true)
    @Mapping(target = "lastUpdate", ignore = true)
    @Mapping(target = "ensemble", ignore = true)
    @Mapping(target = "options", ignore = true)
    @Mapping(target = "weight", expression = "java(dto.getWeight() != null ? dto.getWeight() : DEFAULT_WEIGHT)")
    void update(@MappingTarget EnsembleVoiceEntity entity, EnsembleVoice dto);
}
