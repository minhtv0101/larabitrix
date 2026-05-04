# Larabitrix

Một lớp trung gian (Cloudflare Worker) đứng giữa n8n / Wix / app của bạn và Bitrix24. Thay vì gọi thẳng vào API phức tạp của Bitrix, bạn gọi vào Larabitrix bằng JSON sạch sẽ — nó tự lo phần còn lại.

**Larabitrix giải quyết gì?**

| Vấn đề của Bitrix24 | Larabitrix xử lý như thế nào |
|---------------------|------------------------------|
| Tên trường là `PROPERTY_112` — không ai nhớ nổi | Tự học và dịch thành `so_buoi_hoc` |
| `lists.element.update` xóa trắng trường nếu không truyền | Tự GET dữ liệu cũ rồi merge trước khi update |
| Rate limit 2 req/s, dễ bị 429 | Tự giới hạn tốc độ + retry tự động |
| Upsert (tìm có thì update, không có thì tạo mới) phải viết tay | Endpoint `upsert/:field` xử lý sẵn |

---

## Cách dùng nhanh

### Bước 1 — Chuẩn bị

Cần có:
- [Node.js 18+](https://nodejs.org/)
- Tài khoản [Cloudflare](https://cloudflare.com/) (miễn phí)
- Webhook URL của Bitrix24 (lấy tại **Bitrix24 → Tích hợp → Webhook → Incoming**)

```bash
npm install -g wrangler   # cài Wrangler CLI một lần
```

### Bước 2 — Cài và test local

```bash
git clone https://github.com/minhtv0101/larabitrix.git
cd larabitrix
npm install
npm test          # chạy 43 tests để kiểm tra
```

### Bước 3 — Deploy lên Cloudflare

```bash
wrangler login    # đăng nhập Cloudflare, mở trình duyệt tự động

wrangler deploy   # deploy Worker, lấy URL dạng: https://larabitrix.<ten-ban>.workers.dev
```

### Bước 4 — Nạp 2 biến bí mật

```bash
wrangler secret put BITRIX_WEBHOOK_URL
# Dán vào: https://your-domain.bitrix24.com/rest/1/xxxxxxxxxxxxx/

wrangler secret put WORKER_API_KEY
# Tự đặt một chuỗi bí mật bất kỳ, VD: my-secret-key-2024
```

Xong. Worker đã sẵn sàng.

---

## Deploy cho nhiều công ty (multi-client)

Một repo duy nhất, mỗi công ty một Worker riêng biệt:

**1. Thêm client mới vào `wrangler.jsonc`:**

```jsonc
"env": {
  "cong_ty_a": { "name": "larabitrix-cong-ty-a" },
  "cong_ty_b": { "name": "larabitrix-cong-ty-b" }
}
```

**2. Deploy và nạp secrets cho từng client:**

```bash
wrangler deploy --env cong_ty_a
wrangler secret put BITRIX_WEBHOOK_URL --env cong_ty_a
wrangler secret put WORKER_API_KEY --env cong_ty_a

wrangler deploy --env cong_ty_b
wrangler secret put BITRIX_WEBHOOK_URL --env cong_ty_b
wrangler secret put WORKER_API_KEY --env cong_ty_b
```

Mỗi client có URL riêng, webhook Bitrix riêng, key riêng — hoàn toàn độc lập.

---

## API Reference

Mọi request cần header: `Authorization: Bearer <WORKER_API_KEY>`

### Lists (Universal Lists của Bitrix24)

```
GET    /api/lists/:listId               Lấy danh sách (hỗ trợ ?page=2)
POST   /api/lists/:listId               Tạo mới item
PATCH  /api/lists/:listId/upsert/:field Tìm theo field, update nếu có / tạo mới nếu không
PATCH  /api/lists/:listId/:itemId/math/:field   Cộng/trừ giá trị số (VD: số buổi học)
DELETE /api/lists/:listId/:itemId       Xóa item
DELETE /api/cache/:listId               Xóa cache schema (khi bạn thêm trường mới trong Bitrix)
```

### CRM

```
PATCH  /api/crm/contact/upsert/PHONE        Upsert Contact theo số điện thoại
PATCH  /api/crm/company/upsert/UF_CRM_MST   Upsert Company theo mã số thuế
POST   /api/crm/deal                         Tạo Deal
```

### Ví dụ thực tế

```bash
# Upsert học viên trong Lists (tự dịch tên trường, tự merge dữ liệu cũ)
curl -X PATCH https://larabitrix.<ten-ban>.workers.dev/api/lists/42/upsert/ma_hoc_vien \
  -H "Authorization: Bearer my-secret-key-2024" \
  -H "Content-Type: application/json" \
  -d '{"ma_hoc_vien": "HV001", "so_buoi_hoc": 10, "trang_thai": "dang_hoc"}'

# Trừ 1 buổi học
curl -X PATCH https://larabitrix.<ten-ban>.workers.dev/api/lists/42/HV001-item-id/math/so_buoi_hoc \
  -H "Authorization: Bearer my-secret-key-2024" \
  -H "Content-Type: application/json" \
  -d '{"amount": -1}'

# Upsert contact theo SĐT
curl -X PATCH https://larabitrix.<ten-ban>.workers.dev/api/crm/contact/upsert/PHONE \
  -H "Authorization: Bearer my-secret-key-2024" \
  -H "Content-Type: application/json" \
  -d '{"phone": "0901234567", "NAME": "Nguyen Van A"}'
```

---

## Câu hỏi thường gặp

**Tên trường lấy từ đâu?** Larabitrix tự gọi Bitrix API để học cấu trúc List của bạn. Tên trường trong Bitrix (VD: "Số buổi học") sẽ được chuyển thành slug (`so_buoi_hoc`) để dùng trong JSON.

**Thêm trường mới trong Bitrix thì sao?** Gọi `DELETE /api/cache/:listId` để xóa cache schema. Lần sau sẽ tự học lại.

**Xem log realtime:**
```bash
wrangler tail
wrangler tail --env cong_ty_a   # nếu dùng multi-client
```

**Có cần Cloudflare KV không?** Không cần. KV chỉ là cache tùy chọn giúp schema tồn tại lâu hơn giữa các lần Worker restart. Không có KV, Worker vẫn chạy bình thường.

---

## License

MIT
