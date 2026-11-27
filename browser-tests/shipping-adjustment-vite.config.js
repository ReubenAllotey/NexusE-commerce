import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const root = path.resolve(process.cwd());
const mockSupabase = path.resolve(root, "browser-tests/shippingAdjustmentMockSupabase.js");
const mockProductData = path.resolve(root, "browser-tests/shippingAdjustmentMockProductData.jsx");
const mockBatchStorage = path.resolve(root, "browser-tests/shippingAdjustmentMockBatchStorage.js");
const mockShipmentStorage = path.resolve(root, "browser-tests/shippingAdjustmentMockShipmentStorage.js");
const mockShipmentTrack = path.resolve(root, "browser-tests/shippingAdjustmentMockShipmentTrack.jsx");
const mockAdminAuth = path.resolve(root, "browser-tests/shippingAdjustmentMockAdminAuth.js");

export default defineConfig({
  root,
  resolve: { alias: [
    { find: "/src/lib/supabaseClient.js", replacement: mockSupabase },
    { find: "../../../shared/batchStorage", replacement: mockBatchStorage },
    { find: "../../../shared/shipmentStorage", replacement: mockShipmentStorage },
    { find: "../../../shared/ShipmentTrack", replacement: mockShipmentTrack },
    { find: "../../Products/productData", replacement: mockProductData },
    { find: "../Auth/adminAuthStorage", replacement: mockAdminAuth },
    { find: /[\\/]shared[\\/]batchStorage(?:\.js)?$/, replacement: mockBatchStorage },
    { find: /[\\/]shared[\\/]shipmentStorage(?:\.js)?$/, replacement: mockShipmentStorage },
    { find: /[\\/]shared[\\/]ShipmentTrack(?:\.jsx)?$/, replacement: mockShipmentTrack },
    { find: /[\\/]pages[\\/]Products[\\/]productData(?:\.js)?$/, replacement: mockProductData },
  ] },
  plugins: [react(), {
    name: "shipping-adjustment-test-mocks",
    enforce: "pre",
    resolveId(source) {
      if (source.includes("lib/supabaseClient")) return mockSupabase;
      if (source.includes("Products/productData")) return mockProductData;
      if (source.includes("shared/batchStorage")) return mockBatchStorage;
      if (source.includes("shared/shipmentStorage")) return mockShipmentStorage;
      if (source.includes("shared/ShipmentTrack")) return mockShipmentTrack;
      if (source.includes("Auth/adminAuthStorage")) return mockAdminAuth;
      return null;
    },
  }],
  server: { port: 4176, host: "127.0.0.1" },
});
