# TimeMark Studio

Ứng dụng web thử nghiệm để giáo viên thay nội dung mốc ngày giờ trên ảnh TimeMark. Giao diện và nội dung hiện đang dùng tiếng Việt.

## Xuất bản

Bản production đang chạy trên Vercel:

**https://timemark-studio.vercel.app/**

Repository GitHub vẫn ở chế độ riêng tư. GitHub Pages không được dùng để triển khai ứng dụng.

## Chạy thử

```bash
npm install
npm run dev
```

Mở URL do Vite hiển thị. Khi không có API/database được cấu hình, Vite chỉ bật tài khoản demo cục bộ `giaovien` / `timemark123`; tài khoản này chỉ để phát triển, không có trên production. Có thể bấm **Ảnh mẫu** để khôi phục ảnh minh hoạ. Dùng **Chọn ảnh** để mở JPG, PNG hoặc WebP từ thiết bị.

## Khởi tạo tài khoản production

Production dùng API serverless của Vercel và Neon Postgres. Có thể kiểm tra kết nối bằng `https://timemark-studio.vercel.app/api/health/db`; `ok: true` xác nhận truy vấn SQL tới DB đã chạy thành công. Vercel cần có biến kết nối `DATABASE_URL` (Neon đã gắn vào project) và biến bí mật `TIMEMARK_ADMIN_SETUP_TOKEN` trong môi trường Production. Tạo token ngẫu nhiên dài ít nhất 32 ký tự, đặt loại **Sensitive**, rồi triển khai lại; không đưa token hoặc chuỗi kết nối vào Git hay chat.

Mở trang production lần đầu để tạo tài khoản admin của bạn (tên đăng nhập tùy chọn, mật khẩu tối thiểu 12 ký tự). Quá trình này tạo 10 tài khoản con `hocvien01`–`hocvien10` và một tài khoản giáo viên thử `giaovien`. Mật khẩu tạm chỉ hiện một lần để lưu/tải CSV; người dùng phải đổi mật khẩu ở lần đăng nhập đầu. Admin có thể tạo thêm tài khoản, đặt lại mật khẩu và khóa/mở tài khoản từ nút **Tài khoản** trên thanh trên cùng.

## Kiểm thử trực tiếp trên web

Sau khi đăng nhập, mở **Kiểm thử trên web** ở thanh điều hướng bên trái. Bộ test nằm ngay trên màn hình chỉnh sửa và cho phép:

1. Dùng ảnh minh hoạ hoặc chọn ảnh của bạn.
2. Quét lại khung chữ, chạy OCR, rồi kiểm tra nội dung nhận dạng trong phần xem trước OCR của trình chỉnh sửa.
3. Nạp bộ giá trị thử có địa điểm dài để xem bố cục giờ/ngày quanh gạch cam.
4. Đánh dấu 5 tiêu chí **Đạt/Lỗi**, ghi chú hiện tượng lem/bóng chữ, rồi sao chép báo cáo (nếu trình duyệt chặn clipboard, báo cáo TXT sẽ được tải xuống).

Bộ test là checklist thao tác thủ công trên giao diện; **Kiểm thử và build** phía dưới là bộ test tự động của dự án.

## Những gì bản thử nghiệm làm được

- Quét tương phản ở bốn góc để **gợi ý vùng** có chữ; cho phép chọn góc hoặc kéo để vẽ lại vùng.
- Chạy OCR tiếng Việt + tiếng Anh ngay trong trình duyệt trên vùng đã chọn; xem phần chữ thô, độ tin cậy và trường được nhận dạng trước khi áp dụng vào ô thứ/ngày/giờ/địa điểm.
- Nhập thứ, ngày, giờ và địa điểm; tuỳ chỉnh màu, cỡ chữ, căn lề, khoảng cách dòng, độ đậm, bóng và độ đục. Nút **Khớp ảnh gốc** ước lượng gần đúng màu/cỡ/căn lề/khoảng cách từ vùng chữ đã chọn.
- Lấy mẫu màu mực cũ bằng cách chọn một điểm trên ảnh. Bộ làm sạch dùng OpenCV.js Telea inpainting cục bộ, mở rộng mask nhẹ để xoá viền khử răng cưa/bóng và nhận diện vạch nhấn màu mảnh. Khi phát hiện gạch cam dọc, thời gian được đặt bên trái, ngày/thứ bên phải và gạch được vẽ lại đúng vị trí/màu; địa điểm nằm phía dưới. Chế độ nội suy cơ bản là phương án dự phòng nếu chưa nạp được OpenCV.
- Xuất PNG (không nén mất dữ liệu khi xuất) hoặc JPG chất lượng 97%. Canvas xuất dùng đúng chiều rộng và chiều cao pixel của ảnh đã mở, không chủ động co kích thước.
- Có thể cài như ứng dụng web và dùng ngoại tuyến sau khi mở trang ít nhất một lần (trình duyệt cần hỗ trợ service worker; khi triển khai cần HTTPS). Để OCR và bộ tẩy nâng cao hoạt động offline, hãy chạy OCR và làm sạch chữ ít nhất một lần khi có kết nối để trình duyệt nạp/lưu mô hình và OpenCV.js.

## Bảo mật và quyền riêng tư

Đăng nhập production được kiểm tra ở máy chủ; mật khẩu được băm bằng scrypt, phiên đăng nhập dùng cookie HttpOnly/Secure và tài khoản con có thể bị admin khóa hoặc đặt lại mật khẩu. Ảnh vẫn được giải mã, xử lý và xuất ngay trong trình duyệt — ứng dụng không tải ảnh lên Neon hay Vercel. Đăng nhập cần kết nối mạng; sau khi đã vào ứng dụng, thao tác ảnh vẫn chạy cục bộ.

Tài khoản demo `giaovien` / `timemark123` chỉ có trong môi trường phát triển Vite, không phải tài khoản production. Bảo vệ biến `DATABASE_URL` và `TIMEMARK_ADMIN_SETUP_TOKEN` bằng cài đặt Sensitive của Vercel; không chia sẻ giá trị của chúng.

Bộ quét chỉ gợi ý **vị trí có khả năng chứa chữ**; với khung hẹp ở góc dưới, ứng dụng nới khung vừa đủ để giữ cả khối mốc nhiều dòng nhưng vẫn cần kiểm tra và có thể kéo lại. OCR có thể nhận sai, nhất là trên ảnh nhỏ, chữ mờ hoặc nền phức tạp. Hãy xem văn bản thô/độ tin cậy và soát lại các trường trước khi áp dụng. Telea inpainting giảm vệt chữ cũ so với nội suy đơn giản, nhưng không thể khôi phục chính xác chi tiết bị chữ che trên nền nhiều hoạ tiết; hãy so sánh ảnh gốc và kiểm tra tệp đầu ra.

Ảnh được giải mã, xem trước và xuất ngay trong trình duyệt, không được tải lên dịch vụ nào. Ảnh minh hoạ là ảnh demo đi kèm ứng dụng.

## Kiểm thử và build

```bash
npm test
npm run build
npm run preview
```
