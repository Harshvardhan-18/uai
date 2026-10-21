/**
 * WooCommerce REST API v3 Client
 */

export interface WooCommerceConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export class WooCommerceClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: WooCommerceConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    const credentials = `${config.consumerKey}:${config.consumerSecret}`;
    this.authHeader = `Basic ${Buffer.from(credentials).toString("base64")}`;
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/wp-json/wc/v3/${endpoint.replace(/^\/+/, "")}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers as Record<string, string> || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      const errorMsg = data?.message || data?.code || `HTTP error ${response.status}`;
      throw new Error(`WooCommerce API error (${response.status}): ${errorMsg}`);
    }

    return data as T;
  }

  // 1. list_products
  async listProducts(params: { search?: string; category?: string; per_page?: number; page?: number } = {}) {
    const query = new URLSearchParams();
    if (params.search) query.append("search", params.search);
    if (params.category) query.append("category", params.category);
    if (params.per_page) query.append("per_page", String(params.per_page));
    if (params.page) query.append("page", String(params.page));

    const qs = query.toString();
    const endpoint = qs ? `products?${qs}` : "products";
    return this.request<any[]>(endpoint);
  }

  // 2. create_product
  async createProduct(data: {
    name: string;
    regular_price: string;
    description?: string;
    short_description?: string;
    status?: string;
  }) {
    return this.request<any>("products", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // 3. list_orders
  async listOrders(params: { status?: string; after?: string; before?: string; per_page?: number; page?: number } = {}) {
    const query = new URLSearchParams();
    if (params.status && params.status !== "any") query.append("status", params.status);
    if (params.after) query.append("after", params.after);
    if (params.before) query.append("before", params.before);
    if (params.per_page) query.append("per_page", String(params.per_page));
    if (params.page) query.append("page", String(params.page));

    const qs = query.toString();
    const endpoint = qs ? `orders?${qs}` : "orders";
    return this.request<any[]>(endpoint);
  }

  // 4. get_order
  async getOrder(id: number) {
    return this.request<any>(`orders/${id}`);
  }

  // 5. update_order_status
  async updateOrderStatus(id: number, status: string) {
    return this.request<any>(`orders/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  }
}
