import { useMemo } from "react";

export const SHIPMENT_STEPS = [];

export function useShipmentBatches({ orders = [] } = {}) {
  return useMemo(() => ({ primaryShipment: null, batches: [] }), [orders]);
}

export async function loadAdminShipmentTracks() { return { ok: true, tracks: [] }; }
export async function archiveShipmentTrack() { return { ok: true }; }
export async function saveShipmentTrack() { return { ok: true }; }
export async function saveShipmentTrackStages() { return { ok: true, stages: [] }; }
