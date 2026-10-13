# THẬP KỶ — Fire Club Ticketing Website

Website demo đặt vé cho đêm nhạc kỷ niệm 10 năm CLB Fire (2016–2026). Dự án bao gồm giao diện khách, giao diện quản trị, API/backend, SQLite, xác thực tài khoản, giữ chỗ, gửi minh chứng chuyển khoản và duyệt đơn.

## 1. Yêu cầu cài đặt

- Node.js **20 trở lên** (khuyến nghị Node.js 22 LTS).
- npm (được cài kèm Node.js).
- Trình duyệt mới như Chrome, Edge hoặc Firefox.
- Không cần cài MySQL/SQL Server. Cơ sở dữ liệu SQLite được tạo tự động; mặc định ở `src/data.sqlite`, hoặc trong thư mục `DATA_DIR` nếu bạn cấu hình biến môi trường này.

Tải Node.js từ trang chính thức: https://nodejs.org/

## 2. Chạy lần đầu trên Windows

1. Giải nén `thap-ky-ticketing.zip` vào một thư mục dễ tìm, ví dụ `D:\Projects\thap-ky-ticketing`.
2. Mở thư mục đó bằng VS Code (`File` → `Open Folder`).
3. Trong VS Code chọn `Terminal` → `New Terminal`.
4. Kiểm tra Node/npm:

   ```bash
   node -v
   npm -v
   ```

5. Tạo file cấu hình `.env` từ mẫu. Có thể sao chép `.env.example`, đổi tên bản sao thành `.env`, rồi sửa các giá trị.
   - PowerShell: `Copy-Item .env.example .env`
   - CMD: `copy .env.example .env`
6. Cài các thư viện:

   ```bash
   npm install
   ```

7. Khởi chạy website:

   ```bash
   npm start
   ```

8. Mở đường dẫn trong trình duyệt:
   - Website khách: http://localhost:3000
   - Trang Admin: http://localhost:3000/admin
   - Kiểm tra máy chủ: http://localhost:3000/health

Giữ cửa sổ terminal đang chạy trong lúc sử dụng website. Dừng máy chủ bằng `Ctrl + C`.

## 3. Tài khoản Admin demo

Lần chạy đầu tiên, tài khoản mặc định là:

- Email: `admin@thapky.local`
- Mật khẩu: `FireAdmin@2026`

Thông tin này phục vụ kiểm thử local. Hãy đổi `ADMIN_EMAIL`, `ADMIN_PASSWORD` và `SESSION_SECRET` trong `.env` trước khi triển khai hoặc chia sẻ website. **Lưu ý:** nếu cơ sở dữ liệu đã được tạo, thay `ADMIN_PASSWORD` trong `.env` không tự ghi đè mật khẩu Admin hiện có. Có thể đổi mật khẩu bằng cách cập nhật tài khoản qua công cụ quản trị phù hợp, hoặc xóa `src/data.sqlite` khi chỉ có dữ liệu demo rồi khởi động lại (việc xóa DB sẽ xóa tất cả tài khoản/đơn vé đã thử).

## 4. Luồng test đề xuất

### A. Tạo tài khoản khách

1. Mở http://localhost:3000.
2. Nhấn `Đăng nhập` → tab `Tạo tài khoản`.
3. Nhập tên, email của bạn và mật khẩu tối thiểu 8 ký tự.
4. Nhấn `Tạo tài khoản`. Website sẽ đăng nhập tài khoản khách tự động.

### B. Giữ vé và xem bộ đếm

1. Cuộn tới `Vé tham dự`.
2. Chọn một hạng vé; giá và số lượng hiện tại là dữ liệu demo.
3. Chọn số lượng từ 1–6 rồi nhấn `Giữ chỗ ngay`.
4. Hộp thanh toán sẽ hiện mã đơn, số tiền, nội dung chuyển khoản và bộ đếm giữ chỗ. Mặc định giữ vé 10 phút.
5. Mở `Tài khoản của tôi` để kiểm tra đơn. Có thể hủy đơn giữ chỗ khi chưa gửi minh chứng.

### C. Thử tải minh chứng (không cần chuyển tiền thật)

1. Dùng một ảnh bất kỳ dạng JPG/PNG/WEBP hoặc PDF nhỏ hơn 5 MB trên máy để thử nghiệm.
2. Trong hộp thanh toán, chọn tệp và nhấn `Gửi minh chứng`.
3. Đơn chuyển sang `Chờ duyệt thanh toán`; chỗ đó tiếp tục được giữ khi Admin kiểm tra.
4. Không chuyển tiền thật vào tài khoản mẫu đang hiển thị.

### D. Duyệt đơn ở Admin

1. Mở http://localhost:3000/admin.
2. Đăng nhập bằng tài khoản Admin ở mục 3.
3. Trong phần `Đơn đặt vé`, lọc `Chờ duyệt`.
4. Nhấn `Mở minh chứng` để kiểm tra tệp.
5. Có thể ghi chú, sau đó nhấn `Duyệt` hoặc `Từ chối`. Hai thao tác đều yêu cầu xác nhận.
6. Kiểm tra trạng thái đơn bên khách trong `Tài khoản của tôi`; số liệu tổng quan của Admin cũng sẽ cập nhật.

### E. Chỉnh cấu hình show/giá vé

- Trong Admin, phần `Thông tin chương trình` cho phép sửa tên, ngày, giờ, địa điểm, địa chỉ, thông tin chuyển khoản và số phút giữ vé (3–60 phút).
- Phần `Hạng vé và số lượng` cho phép sửa tên vé, giá VND, tổng kho, giới thiệu ngắn và trạng thái mở bán.
- Dùng `Xuất CSV` để tải danh sách đơn đặt vé đang có trong cơ sở dữ liệu (tối đa 300 đơn gần nhất từ API).

## 5. Cấu trúc mã nguồn

```text
thap-ky-ticketing/
├── src/
│   └── server.js          # Express API, auth, giữ vé, upload, Admin endpoints
├── public/
│   ├── index.html         # Website khách
│   ├── styles.css         # Giao diện khách, animation và responsive
│   ├── app.js             # Luồng đăng nhập, đặt vé, minh chứng, tài khoản
│   ├── admin.html         # Trang Admin
│   ├── admin.css          # Giao diện Admin
│   ├── admin.js           # Quản trị đơn, cấu hình show, giá/kho vé
│   └── assets/            # Hình nền cosmic-gold và poster show
├── uploads/               # Minh chứng do người dùng tải lên (không public trực tiếp)
├── .env.example           # Mẫu cấu hình
├── package.json
└── README.md
```

## 6. Lưu ý quan trọng trước khi triển khai thật

- Đây là bản MVP/demo chạy local. Không tự động kết nối ngân hàng hoặc xác minh giao dịch; Admin phải đối chiếu giao dịch ngoài hệ thống trước khi duyệt.
- Tài khoản ngân hàng và giá vé ban đầu chỉ là dữ liệu mẫu. Cập nhật và xác minh với Ban tổ chức trong Admin trước khi nhận bất cứ khoản tiền nào.
- `express-session` dùng MemoryStore mặc định, phù hợp thử nghiệm local chứ không phù hợp cho production; cần chuyển sang session store bền vững.
- Trước khi public website, cần bổ sung HTTPS, CSRF protection, email xác nhận/khôi phục mật khẩu, lưu trữ session an toàn, sao lưu DB, quy trình xóa dữ liệu cá nhân, logging/audit cho thao tác Admin, kiểm tra định dạng file thực tế (không chỉ MIME), chính sách bảo mật và kiểm thử tải.
- Đặt `NODE_ENV=production`, `SESSION_SECRET` khó đoán và thông tin Admin mạnh khi triển khai sau khi đã hoàn thiện các biện pháp bảo mật cần thiết.

## 7A. Deploy trên Render

Trong Render Dashboard → Web Service → Settings, dùng:

- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Health Check Path (nếu có):** `/health`

Trong Environment, đặt:

- `NODE_ENV` = `production`
- `SESSION_SECRET` = một chuỗi ngẫu nhiên dài, không dùng giá trị mẫu
- `ADMIN_EMAIL` = email Admin bạn muốn dùng
- `ADMIN_PASSWORD` = mật khẩu Admin mạnh

Bản này đã cấu hình Express trust proxy cho production để cookie phiên đăng nhập hoạt động sau proxy HTTPS của Render. Sau khi sửa source, hãy commit/push lên Git repository đang kết nối với Render rồi **Manual Deploy → Deploy latest commit**.

**Lưu ý về lưu dữ liệu:** mặc định Render dùng filesystem tạm thời. Nếu không có persistent disk, tài khoản, đơn vé, cấu hình và file minh chứng lưu trong SQLite/uploads có thể mất khi service restart hoặc redeploy. Render hiện cho gắn persistent disk với dịch vụ trả phí; nếu có disk, gắn tại `/var/data` và đặt `DATA_DIR=/var/data`. Nếu cần chạy trên gói không có disk bền vững, nên chuyển database sang Render Postgres và minh chứng sang object storage thay vì SQLite trên filesystem.

**Tài khoản Admin:** email/mật khẩu chỉ được dùng để tạo tài khoản Admin khi database chưa có Admin với email đó. Đổi các biến môi trường sau khi database đã có tài khoản không tự đổi mật khẩu đã lưu. Nếu bạn không đăng nhập được, kiểm tra Render Logs và dùng đúng `ADMIN_EMAIL`/`ADMIN_PASSWORD` được thiết lập trước lúc database khởi tạo; không gửi mật khẩu thật lên chat.

## 7B. Lỗi thường gặp

**`npm install` lỗi tại better-sqlite3:** dùng Node.js phiên bản LTS hiện hành (khuyến nghị Node 22), cập nhật npm, sau đó chạy `npm install` lại. Trên một số bản Windows cũ, thư viện native có thể cần công cụ build của Visual Studio.

**Cổng 3000 đã được sử dụng:** đổi `PORT=3001` trong `.env` rồi khởi động lại; dùng http://localhost:3001.

**Trang mở nhưng dữ liệu không tải:** xem terminal đang chạy `npm start`, sau đó mở http://localhost:3000/health và kiểm tra có trả về `{"ok":true,...}` hay không.

**Muốn làm lại demo từ đầu:** dừng máy chủ (`Ctrl+C`), sao lưu nếu cần, xóa file `data.sqlite`, `data.sqlite-shm`, `data.sqlite-wal` (nếu có) trong thư mục dữ liệu đã cấu hình (`DATA_DIR`, hoặc `src/` nếu chưa cấu hình), xóa các tệp trong `uploads/` rồi chạy `npm start`. Thao tác này xóa tài khoản, đơn vé và cấu hình đã chỉnh; các hạng vé/cấu hình mẫu sẽ được tạo lại.
