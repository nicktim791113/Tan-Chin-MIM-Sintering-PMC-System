import { createStructuredBatchModule } from "./structured-batch.js";

export function createSinteringModule(context) {
  return createStructuredBatchModule(context, {
    pageLabel: "真空式燒結作業",
    itemLabel: "真空式燒結",
    machineLabel: "真空式燒結爐",
    machineShortLabel: "爐號",
    formId: "sintering-form",
    itemsRootId: "sintering-items",
    machineCardsRootId: "sintering-machine-cards",
    machineInfoRootId: "sintering-machine-info",
    recommendationsRootId: "sintering-recommendations",
    recommendationDetailId: "sintering-recommendation-detail",
    batchesRootId: "sintering-batches-table",
    addItemButtonId: "sintering-add-item",
    calculateButtonId: "sintering-calculate",
    resetButtonId: "sintering-form-reset",
    machineIdPayloadKey: "furnace_machine_id",
    machineCodeKey: "furnace_machine_code",
    getMachines: () => context.getState().furnaces.filter((machine) => machine.machine_status === "active"),
    calculateLayout: (payload) => context.api.sintering.calculateLayout(payload),
    createBatch: (payload) => context.api.sintering.createBatch(payload),
    listBatches: (filters) => context.api.sintering.listBatches(filters)
  });
}
