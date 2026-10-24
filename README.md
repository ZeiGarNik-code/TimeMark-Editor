# TimeMark Studio

Ứng dụng web thử nghiệm để giáo viên thay nội dung mốc ngày giờ trên ảnh TimeMark. Giao diện và nội dung hiện đang dùng tiếng Việt.

## Chạy thử

```bash
npm install
npm run dev
```

Mở URL do Vite hiển thị. Tài khoản demo:

- **Tài khoản:** `giaovien`
- **Mật khẩu:** `timemark123`

Có thể bấm **Ảnh mẫu** để khôi phục ảnh minh hoạ. Dùng **Chọn ảnh** để mở JPG, PNG hoặc WebP từ thiết bị.

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

## Giới hạn quan trọng

Đây là **prototype chạy hoàn toàn ở trình duyệt**, không có máy chủ. Màn hình đăng nhập và tài khoản trên chỉ để kiểm thử giao diện, không phải cơ chế xác thực an toàn; ai cũng có thể xem thông tin tài khoản trong mã nguồn. Không dùng tài khoản này để bảo vệ ảnh hoặc dữ liệu thật khi đưa lên Internet. Muốn phục vụ một nhóm giáo viên thật cần bổ sung xác thực phía máy chủ, tài khoản riêng và chính sách lưu trữ phù hợp.

Bộ quét chỉ gợi ý **vị trí có khả năng chứa chữ**; với khung hẹp ở góc dưới, ứng dụng nới khung vừa đủ để giữ cả khối mốc nhiều dòng nhưng vẫn cần kiểm tra và có thể kéo lại. OCR có thể nhận sai, nhất là trên ảnh nhỏ, chữ mờ hoặc nền phức tạp. Hãy xem văn bản thô/độ tin cậy và soát lại các trường trước khi áp dụng. Telea inpainting giảm vệt chữ cũ so với nội suy đơn giản, nhưng không thể khôi phục chính xác chi tiết bị chữ che trên nền nhiều hoạ tiết; hãy so sánh ảnh gốc và kiểm tra tệp đầu ra.

Ảnh được giải mã, xem trước và xuất ngay trong trình duyệt, không được tải lên dịch vụ nào. Ảnh minh hoạ là ảnh demo đi kèm ứng dụng.

## Kiểm thử và build

```bash
npm test
npm run build
npm run preview
```
