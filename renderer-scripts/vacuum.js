import { createStructuredBatchModule } from "./structured-batch.js";

export function createVacuumModule(context) {
  return createStructuredBatchModule(context, {
    pageLabel: "真空式脫脂作業",
    itemLabel: "真空式脫脂",
    machineLabel: "真空式脫脂爐",
    machineShortLabel: "爐號",
    formId: "vacuum-form",
    itemsRootId: "vacuum-items",
    machineCardsRootId: "vacuum-machine-cards",
    machineInfoRootId: "vacuum-machine-info",
    recommendationsRootId: "vacuum-recommendations",
    recommendationDetailId: "vacuum-recommendation-detail",
    batchesRootId: "vacuum-batches-table",
    addItemButtonId: "vacuum-add-item",
    calculateButtonId: "vacuum-calculate",
    resetButtonId: "vacuum-form-reset",
    machineIdPayloadKey: "vacuum_machine_id",
    machineCodeKey: "vacuum_machine_code",
    getMachines: () => context.getState().vacuumProfiles.filter((machine) => machine.machine_status === "active"),
    calculateLayout: (payload) => context.api.vacuum.calculateLayout(payload),
    createBatch: (payload) => context.api.vacuum.createBatch(payload),
    listBatches: (filters) => context.api.vacuum.listBatches(filters)
  });
}
