import { execSync } from "child_process";

async function main() {
  const ckB64 = execSync('kubectl get secret -n uai uai-woo-credentials -o jsonpath="{.data.consumer-key}"', { encoding: "utf-8" }).trim();
  const csB64 = execSync('kubectl get secret -n uai uai-woo-credentials -o jsonpath="{.data.consumer-secret}"', { encoding: "utf-8" }).trim();
  const ck = Buffer.from(ckB64, "base64").toString("utf-8");
  const cs = Buffer.from(csB64, "base64").toString("utf-8");
  const authHeader = "Basic " + Buffer.from(`${ck}:${cs}`).toString("base64");

  // Get products first
  const prodRes = await fetch("http://store.localtest.me/wp-json/wc/v3/products?per_page=1", {
    headers: { Authorization: authHeader },
  });
  const products = await prodRes.json();
  const productId = products[0]?.id || 1;

  // Create an order
  const orderRes = await fetch("http://store.localtest.me/wp-json/wc/v3/orders", {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payment_method: "cod",
      payment_method_title: "Cash on delivery",
      set_paid: false,
      billing: {
        first_name: "John",
        last_name: "Doe",
        address_1: "123 Market St",
        city: "San Francisco",
        state: "CA",
        postcode: "94103",
        country: "US",
        email: "john.doe@example.com",
        phone: "(555) 555-5555",
      },
      line_items: [
        {
          product_id: productId,
          quantity: 1,
        },
      ],
    }),
  });

  if (!orderRes.ok) {
    throw new Error(`Failed to create order: ${await orderRes.text()}`);
  }

  const order = await orderRes.json();
  console.log(`Created test order #${order.id} with total: $${order.total} ${order.currency}`);
}

main().catch(console.error);
