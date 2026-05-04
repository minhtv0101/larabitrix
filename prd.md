PRD & KNOWLEDGE BASE: LARABITRIX FRAMEWORK

(Cloudflare Worker Middleware for Bitrix24)

1. Giới thiệu dự án

Larabitrix là một Middleware được xây dựng trên hạ tầng Cloudflare Workers. Nó đóng vai trò là tầng API Gateway, ORM, và Queue Handler nằm giữa các nền tảng tự động hóa (n8n, Wix, Landing Pages) và Bitrix24.
Mục tiêu là biến Bitrix24 thành một Headless CRM mạnh mẽ với chuẩn RESTful, xử lý thông minh dữ liệu, khắc phục giới hạn Rate Limit của Bitrix và đảm bảo toàn vẹn dữ liệu (Data Integrity).

2. Kiến trúc hệ thống (System Architecture)

2.1. Sơ đồ luồng xử lý trực quan

graph TD
    subgraph Clients ["Nền tảng tự động hóa (Inbound)"]
        N8N[n8n Workflow]
        WIX[Wix Webhooks]
        APP[Custom Apps]
    end

    subgraph CF ["Cloudflare Hạ tầng (Middleware)"]
        subgraph Worker ["Larabitrix Worker"]
            AUTH[1. Auth Check<br/>Bearer Token]
            ROUTER[2. Smart Router<br/>Lists/CRM]
            MAPPER[3. Schema Mapper<br/>Slugify & Transform]
            ORM[4. ORM Logic<br/>Upsert/Math/Read-before-write]
            LIMITER[5. Rate Limiter<br/>Max 2 req/sec]
        end
        KV[(Cloudflare KV<br/>Schema Cache)]
    end

    subgraph B24 ["Bitrix24 (Outbound)"]
        API_LIST[Universal Lists API]
        API_CRM[CRM API<br/>Contact/Company/Deal]
    end

    N8N -->|REST API| AUTH
    WIX -->|Webhook| AUTH
    APP -->|REST API| AUTH

    AUTH --> ROUTER
    ROUTER --> MAPPER
    MAPPER <-->|Get/Set Cache| KV
    MAPPER --> ORM
    ORM --> LIMITER

    LIMITER -->|Webhook URL| API_LIST
    LIMITER -->|Webhook URL| API_CRM


2.2. Các thành phần lõi

Inbound: Nhận HTTP Request từ n8n/Wix/App qua Webhook.

Worker Layer (The Brain):

Auth Check: Xác thực Bearer Token.

Smart Router: Điều hướng request dựa trên URL (Lists, CRM Entities).

Queue & Rate Limiter: Khống chế tốc độ gọi Bitrix (tối đa 2 req/s) bằng hàm sleep.

Dynamic Schema Mapper: Tự động học và lưu trữ từ điển Mapping giữa tên trường "sạch" và PROPERTY_ID của Bitrix.

ORM Logic Engine: Xử lý các tác vụ phức tạp (UpdateOrCreate, Math, Soft Delete, Read-Before-Write).

Data Sanitizer: Làm sạch dữ liệu trước khi đưa vào CRM.

Outbound: Tương tác với Bitrix24 REST API qua Webhook URL.

Storage Layer: Sử dụng Cloudflare KV để lưu trữ Schema Cache hoặc Cấu hình linh hoạt.

3. Danh sách Tính năng (Features & Use Cases)

3.1. Cơ chế xử lý Bitrix Lists (Lists Module)

Đây là module cốt lõi để giải quyết sự phức tạp của Universal Lists trong Bitrix24:

Dynamic Schema Mapping (Phiên dịch tự động): * Thay vì bắt n8n gửi ID trường khó nhớ (VD: PROPERTY_112), Worker sẽ tự động gọi API lists.field.get để "học" cấu trúc của List đó.

Tự động chuyển đổi (Slugify) tên trường trong Bitrix thành các key JSON "sạch" (VD: "Số buổi học" -> so_buoi_hoc).

Transformation: Khi n8n gửi payload {"so_buoi_hoc": 10}, Worker tự động dịch thành {"PROPERTY_112": 10} trước khi gửi cho Bitrix. Khi lấy dữ liệu về (GET), Worker dịch ngược lại để n8n dễ đọc.

Caching: Schema được lưu trên RAM (hoặc KV) để không phải gọi API "học" lại ở các request sau.

Chống mất dữ liệu (Read-Before-Write):

Đặc thù của API Bitrix lists.element.update là: Nếu không truyền một trường nào đó vào payload, nó sẽ xóa trắng trường đó.

Giải pháp của Worker: Trước khi Update, Worker tự động gọi một lệnh GET để lấy toàn bộ dữ liệu hiện tại của item đó. Sau đó tiến hành gộp (Merge) dữ liệu cũ với dữ liệu mới gửi lên từ n8n. Đảm bảo các trường không được nhắc đến vẫn được giữ nguyên vẹn.

3.2. Core ORM (Tương tác dữ liệu cốt lõi)

updateOrCreate (Upsert): Tìm bản ghi theo Unique Field. Có thì Merge (Cập nhật), chưa có thì Create (Thêm mới). Tránh trùng lặp dữ liệu tuyệt đối.

math (Increment/Decrement): Tự động Get giá trị cũ, tính toán (+/-) và Update giá trị mới. Chống Race Condition. (VD: Quản lý số buổi học).

softDelete: Xóa mềm (đánh dấu is_deleted = Y) để giữ lại log thay vì xóa vĩnh viễn trên Bitrix.

paginate: Phân trang tự động tính toán tham số START của Bitrix qua biến ?page=N.

3.3. CRM Entity Manager

Quản lý đồng nhất các thực thể CRM (Contact, Company, Deal) chung một logic ORM.

Tính năng tự động Bind (Liên kết) Contact và Company vào Deal.

3.4. Các Tính năng Middleware Nâng cao (Advanced Architect)

Ghost Webhook (Webhook Bọc đường): Trả về HTTP 200 OK ngay lập tức cho cổng thanh toán/Wix trong 10ms, sau đó Worker mới thong thả xử lý với Bitrix để tránh bị Timeout phía đối tác.

Webhook Circuit Breaker: Ngắt mạch và Retry (Exponential Backoff) nếu Bitrix quá tải (Error 429/50x), không làm rớt đơn hàng.

Audit Trail & Log Centralized: Tự động bắn log các thao tác update/delete sang một hệ thống log tập trung hoặc một List riêng để kiểm toán.

Data Aggregator: Endpoint gom số liệu tổng hợp (doanh thu, số khách) từ nhiều bảng để n8n lấy báo cáo 1 lần thay vì phải loop.

Virtual Fields (Trường ảo): Tự động tính toán các trường không có sẵn trong Bitrix (VD: Customer Lifetime Value) trả về cho n8n trong lệnh GET.

4. Cấu trúc Endpoints (RESTful API)

Method

Endpoint Pattern

Ý nghĩa

GET

/api/lists/:id?page=1

Lấy danh sách List (hỗ trợ phân trang)

POST

/api/lists/:id

Tạo mới Item trong List

PATCH

/api/lists/:id/upsert/:field

Cập nhật hoặc Tạo mới Item theo Unique Field

PATCH

/api/lists/:id/:itemId/math/:field

Cộng/trừ giá trị số của một trường

PATCH

/api/lists/:id/:itemId/soft-delete

Xóa mềm Item

PATCH

/api/crm/contact/upsert/PHONE

Upsert Contact dựa theo số điện thoại

PATCH

/api/crm/company/upsert/UF_CRM_MST

Upsert Company dựa theo Mã số thuế

POST

/api/crm/deal

Tạo Deal (có thể truyền kèm contact_id, company_id)

5. Quy trình Triển khai (DevOps & Deployment)

Chiến lược: "One Repo to Rule Them All". Quản lý 1 mã nguồn duy nhất trên Github, sử dụng Wrangler CLI để deploy cho nhiều công ty khác nhau. Mỗi công ty 1 Worker độc lập.

5.1. Cấu trúc file wrangler.toml (Infrastructure as Code)

name = "larabitrix-service" # Sẽ bị override khi deploy qua CLI
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
NODE_ENV = "production"
# Không đưa Webhook URL và API Key vào đây để bảo mật

# Nếu dùng KV để lưu cache Schema
# [kv_namespaces]
# binding = "SCHEMA_CACHE"
# id = "..."


5.2. Luồng Deploy 4 bước qua Wrangler CLI

# 1. Đăng nhập vào Cloudflare của khách hàng
wrangler login

# 2. Deploy và gán tên Worker riêng cho dự án
wrangler deploy --name bitrix-worker-[ten-khach-hang]

# 3. Nạp biến môi trường bảo mật (Secrets)
wrangler secret put BITRIX_WEBHOOK_URL
wrangler secret put WORKER_API_KEY

# 4. Xem log realtime để debug (nếu cần)
wrangler tail


6. MÃ NGUỒN CỐT LÕI (CORE CODEBASE)

(Dùng đoạn code này làm Base cho Cursor/Claude)

/**
 * LARABITRIX - THE ULTIMATE BITRIX24 WRAPPER
 * Hỗ trợ: Lists CRUD, CRM Entities, Upsert, Math, Pagination, Rate Limit.
 */

const schemaCache = {}; // Cache trên RAM Worker

class LarabitrixWrapper {
    constructor(webhookUrl) {
        this.webhookUrl = webhookUrl.endsWith('/') ? webhookUrl : webhookUrl + '/';
    }

    // --- UTILS & RATE LIMITER ---
    async sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    
    slugify(text) {
        return text.toString().toLowerCase().replace(/\s+/g, '_').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '_').replace(/^-+|-+$/g, '');
    }

    // Cơ chế gọi API có Sleep 550ms (Đảm bảo < 2 req/s) và Exponential Backoff Retry
    async callApi(method, params, retryCount = 0) {
        await this.sleep(550);
        const response = await fetch(`${this.webhookUrl}${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        if (response.status === 429 || response.status >= 500) {
            if (retryCount < 3) {
                await this.sleep(Math.pow(2, retryCount) * 1000);
                return this.callApi(method, params, retryCount + 1);
            }
        }

        const data = await response.json();
        if (data.error) throw new Error(`${data.error_description} (${data.error})`);
        return data.result;
    }

    // --- SCHEMA DYNAMIC MAPPING (Dành riêng cho Lists) ---
    async buildListSchema(iblockId) {
        if (schemaCache[iblockId]) return schemaCache[iblockId];
        const fields = await this.callApi('lists.field.get', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: iblockId });
        let schema = { toBitrix: {}, toClean: {} };
        for (const [key, fieldData] of Object.entries(fields)) {
            const cleanKey = fieldData.CODE ? fieldData.CODE.toLowerCase() : this.slugify(fieldData.NAME);
            schema.toBitrix[cleanKey] = key;
            schema.toClean[key] = cleanKey;
        }
        schemaCache[iblockId] = schema;
        return schema;
    }

    transformToBitrix(cleanData, schema) {
        let bitrixData = {};
        for (const [key, value] of Object.entries(cleanData)) {
            bitrixData[schema.toBitrix[key] || key] = value;
        }
        return bitrixData;
    }

    // --- BỘ LỆNH ORM CHO LISTS ---
    async getListItems(iblockId, filter = {}, page = null) {
        const schema = await this.buildListSchema(iblockId);
        const params = { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: iblockId, FILTER: filter };
        if (page) params.START = (parseInt(page) - 1) * 50;
        // Chú ý: Cần transform kết quả trả về qua hàm toClean (Claude implement thêm)
        return await this.callApi('lists.element.get', params); 
    }

    async updateListOrCreate(iblockId, uniqueFieldName, payload) {
        const schema = await this.buildListSchema(iblockId);
        const bitrixUniqueKey = schema.toBitrix[uniqueFieldName];
        if (!bitrixUniqueKey) throw new Error(`Không tìm thấy trường: ${uniqueFieldName}`);

        const existing = await this.getListItems(iblockId, { [bitrixUniqueKey]: payload[uniqueFieldName] });
        if (existing.length > 0) {
            // Read-before-write: Get old data, merge, then Update (Claude implement logic merge)
            const id = existing[0].ID;
            return await this.callApi('lists.element.update', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: iblockId, ELEMENT_ID: id, FIELDS: this.transformToBitrix(payload, schema) });
        }
        return await this.callApi('lists.element.add', { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: iblockId, ELEMENT_CODE: `code_${Date.now()}`, FIELDS: this.transformToBitrix(payload, schema) });
    }

    async mathList(iblockId, itemId, fieldName, amount) {
        // Claude implement: Lấy giá trị cũ, ép kiểu Number, cộng thêm amount và Update lại
    }

    // --- BỘ LỆNH ORM CHO CRM ENTITIES (Contact, Company, Deal) ---
    async upsertCrmEntity(entityType, uniqueField, payload) {
        // entityType: 'crm.contact', 'crm.company'
        const searchResult = await this.callApi(`${entityType}.list`, {
            filter: { [uniqueField]: payload[uniqueField] },
            select: ["ID"]
        });

        if (searchResult && searchResult.length > 0) {
            const id = searchResult[0].ID;
            await this.callApi(`${entityType}.update`, { id: id, fields: payload });
            return { action: 'updated', id: id };
        }
        const newId = await this.callApi(`${entityType}.add`, { fields: payload });
        return { action: 'created', id: newId };
    }
}

// --- CLOUDFLARE WORKER ROUTER ---
export default {
    async fetch(request, env, ctx) {
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        };

        if (request.method === 'OPTIONS') return new Response(null, { headers });

        // Bảo mật Token
        if (request.headers.get('Authorization') !== `Bearer ${env.WORKER_API_KEY}`) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
        }

        try {
            const url = new URL(request.url);
            const path = url.pathname.split('/').filter(Boolean); // api, lists|crm, id, action...
            const bitrix = new LarabitrixWrapper(env.BITRIX_WEBHOOK_URL);
            let result = {};
            const body = request.method !== 'GET' && request.method !== 'DELETE' ? await request.json() : null;

            // ĐIỀU HƯỚNG ROUTER (Smart Router)
            if (path[1] === 'lists') {
                const iblockId = path[2];
                const action = path[3];
                const field = path[4];
                // Claude: Hoàn thiện switch case CRUD, Upsert, Math cho phần Lists
            } 
            else if (path[1] === 'crm') {
                const entityType = `crm.${path[2]}`; // crm.contact, crm.company
                const action = path[3]; // upsert
                const field = path[4]; // PHONE, UF_CRM_MST
                if (action === 'upsert') {
                    result = await bitrix.upsertCrmEntity(entityType, field, body);
                }
            }

            return new Response(JSON.stringify({ success: true, data: result }), { status: 200, headers });
        } catch (e) {
            return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers });
        }
    }
};


7. Postman Collection Strategy

Thiết lập Workspace.

Tạo Collection "Larabitrix Core API".

Sử dụng Postman Environment Variables: {{host}}, {{api_key}}.

Chia Folder: [01. Lists], [02. CRM - Contacts], [03. CRM - Companies], [04. CRM - Deals].

URL Mẫu: PATCH {{host}}/api/crm/contact/upsert/PHONE
Body: {"PHONE": [ { "VALUE": "090000000", "VALUE_TYPE": "WORK" } ], "NAME": "Khách hàng A"}

8. Hướng dẫn Prompt cho Claude (Checklist)

Khi cung cấp file này cho Claude, yêu cầu:

"Hãy hoàn thiện các hàm còn thiếu trong class LarabitrixWrapper (phần Transform dữ liệu 2 chiều, Math logic, logic Merge của Update)."

"Hãy hoàn thiện khối Switch-Case Router trong hàm fetch để hứng đủ các API Endpoints (bao gồm các endpoint của Lists)."

"Hãy tối ưu thêm Error Handling trả về chuẩn HTTP Status Code."

"Đảm bảo giữ nguyên kiến trúc Rate Limiting (sleep 550ms) vì Bitrix rất gắt."

9. Tài liệu tham khảo (References - Bitrix24 API Docs)

Để tiện cho việc code và tra cứu các endpoint của Bitrix24, dưới đây là hệ thống tài liệu chính thức:

Tài liệu REST API tổng quát: https://apidocs.bitrix24.com/api-reference/

Module Universal Lists:

Tổng quan Lists: https://apidocs.bitrix24.com/api-reference/lists/index.html

Lấy cấu trúc List (lists.field.get): https://apidocs.bitrix24.com/api-reference/lists/fields/lists-field-get.html

Thêm mới/Cập nhật Element (lists.element.add / .update): https://apidocs.bitrix24.com/api-reference/lists/elements/index.html

Module CRM (Contact, Company, Deal):

Tổng quan CRM API: https://apidocs.bitrix24.com/api-reference/crm/index.html

CRM Contact: https://apidocs.bitrix24.com/api-reference/crm/contacts/index.html

CRM Company: https://apidocs.bitrix24.com/api-reference/crm/companies/index.html

CRM Deal: https://apidocs.bitrix24.com/api-reference/crm/deals/index.html