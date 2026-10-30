import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("the two-stage flow validates address fields before checkout and customer fields before payment", async () => {
  const addressPage = await readFile(new URL("../src/pages/ShippingAddress/ShippingAddress.jsx", import.meta.url), "utf8");
  const payment = await readFile(new URL("../src/pages/payment/payment.jsx", import.meta.url), "utf8");

  assert.match(addressPage, /Please select a region\./);
  assert.match(addressPage, /Please enter your delivery location\./);
  assert.match(payment, /Full name is required\./);
  assert.match(payment, /Phone number is required\./);
});

test("checkout submits camelCase fields and storage maps them to database columns", async () => {
  const component = await readFile(new URL("../src/pages/ShippingAddress/ShippingAddress.jsx", import.meta.url), "utf8");
  const payment = await readFile(new URL("../src/pages/payment/payment.jsx", import.meta.url), "utf8");
  const storage = await readFile(new URL("../src/pages/Profile/addressesStorage.js", import.meta.url), "utf8");

  assert.doesNotMatch(component, /name="fullName"/);
  assert.doesNotMatch(component, /name="phoneNumber"/);
  assert.match(component, /persistAndContinue\(\{[\s\S]*fullName: ""[\s\S]*phoneNumber: ""/);
  assert.match(payment, /if \(authUser && typeof onSaveAddress === "function"\)/);
  assert.match(payment, /fullName: checkoutCustomerName/);
  assert.match(payment, /phoneNumber: checkoutCustomerPhone/);
  assert.match(storage, /full_name: clean\(fields\.fullName\)/);
  assert.match(storage, /phone_number: clean\(fields\.phoneNumber\)/);
});

test("the database contract keeps full name and phone required", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260918_0028_simplify_delivery_address.sql", import.meta.url), "utf8");

  assert.match(migration, /new\.full_name is null/);
  assert.match(migration, /new\.phone_number is null/);
  assert.match(migration, /new\.city is null/);
});
