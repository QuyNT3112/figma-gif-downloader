# 🎬 Figma GIF Downloader & Exporter Plugin

Plugin dành cho **Figma Desktop** giúp trích xuất và tải về các file ảnh GIF động nguyên bản từ canvas thiết kế về máy tính, đồng thời hỗ trợ đóng gói ZIP hàng loạt và ghép các Frame thành hoạt ảnh GIF.

---

## 📌 Tại sao cần plugin này?

Trong Figma Desktop:
- Khi kéo thả file GIF vào Figma, Figma sẽ phát ảnh động trong chế độ Prototype hoặc Canvas.
- **Hạn chế lớn:** Khi dùng tính năng Export mặc định của Figma, Figma **chỉ xuất ra ảnh tĩnh** (PNG, JPG, SVG, PDF) và làm mất hoàn toàn chuyển động của GIF!
- **Giải pháp:** Plugin này truy cập trực tiếp vào vùng nhớ đệm dữ liệu gốc (`Image Fill Hash`) của Figma, trích xuất chuẩn xác từng byte nguyên bản của file GIF và cho phép bạn tải về máy tính với chất lượng 100% gốc.

---

## ✨ Các tính năng nổi bật

1. **Trích xuất GIF nguyên bản 100% (Lossless)**:
   - Tự động nhận diện chữ ký file GIF (`GIF87a`, `GIF89a`).
   - Giữ nguyên toàn bộ số khung hình, độ trong suốt và tốc độ phát gốc.

2. **Hai chế độ quét thông minh**:
   - 🎯 **Theo vùng chọn (Selection):** Chỉ quét các layer bạn đang chọn trên canvas.
   - 🌐 **Toàn bộ trang (Current Page):** Quét đệ quy toàn bộ các Frame, Group, Component trên trang để tìm mọi ảnh GIF.

3. **Giao diện hiện đại & Xem trước động (Live Preview)**:
   - Ảnh GIF chuyển động trực tiếp ngay trên thẻ xem trước.
   - Hiển thị kích thước (Width × Height), dung lượng file (KB/MB) và tên layer.
   - Nút 🎯 **"Chuyển đến layer"**: Tự động zoom và chọn ngay layer tương ứng trên Canvas Figma.

4. **Tải hàng loạt nén ZIP**:
   - Tải nhanh từng ảnh hoặc gom toàn bộ ảnh GIF thành 1 file `.zip` duy nhất với 1 cú click.

5. **Ghép Frame thành GIF (Sequencer)**:
   - Chọn từ 2 Frame trở lên trên Canvas -> Tuỳ chỉnh FPS (4, 8, 12, 20 fps) và Scale (0.5x, 1x, 2x) -> Xuất hoạt ảnh GIF mới.

---

## 🚀 Hướng dẫn cài đặt vào Figma Desktop

### Bước 1: Mở Figma Desktop
Mở ứng dụng **Figma Desktop** trên máy tính của bạn và mở một file thiết kế bất kỳ.

### Bước 2: Nhập Plugin từ Manifest
1. Nhấp vào menu **Figma** (biểu tượng logo Figma ở góc trên bên trái).
2. Di chuột vào **Plugins** > **Development** > chọn **Import plugin from manifest...**.
3. Cửa sổ chọn file hiện ra, duyệt đến thư mục dự án và chọn file:
   ```text
   C:\Users\Admin\.gemini\antigravity-ide\scratch\figma-gif-downloader\manifest.json
   ```
4. Bấm **Open**. Bạn sẽ thấy thông báo *"Plugin imported successfully"*.

### Bước 3: Chạy Plugin
1. Nhấp chuột phải bất kỳ đâu trên Canvas Figma.
2. Chọn **Plugins** > **Development** > **GIF Downloader & Exporter**.
3. Cửa sổ plugin sẽ xuất hiện!

---

## 🧪 Cách thử nghiệm nhanh với File mẫu

Trong thư mục dự án đã có sẵn file ảnh mẫu:
```text
sample-assets/test_sample.gif
```
1. Kéo thả file `test_sample.gif` vào Canvas Figma của bạn.
2. Chọn layer ảnh vừa kéo vào.
3. Mở plugin -> Bấm **"Quét ngay"** -> Bạn sẽ thấy ảnh GIF xuất hiện với hoạt ảnh chuyển động.
4. Bấm **"📥 Tải"** để lưu file về máy tính!

---

## 💻 Dành cho lập trình viên (Development)

Dự án được viết bằng **TypeScript**, đóng gói siêu tốc bằng **esbuild** và chạy hoàn toàn offline (100% self-contained trong `dist/ui.html` và `dist/code.js`).

### Cài đặt dependencies (nếu clone sang máy khác):
```bash
npm install
```

### Build dự án:
```bash
npm run build
```

### Chế độ Watch (tự động build lại khi sửa code trong `src/`):
```bash
npm run dev
# hoặc
npm run watch
```

Sau khi sửa code, bạn chỉ cần bấm chuột phải trên Figma Desktop chọn **Plugins** > **Development** > **Restart Plugin** (phím tắt `Ctrl + Alt + P` trên Windows) để cập nhật thay đổi ngay lập tức!

---

## 📁 Cấu trúc thư mục

```text
figma-gif-downloader/
├── manifest.json         # File cấu hình định danh plugin của Figma
├── package.json          # Quản lý scripts và dependencies
├── tsconfig.json         # Cấu hình TypeScript
├── build.js              # Script build esbuild đóng gói tự động
├── src/
│   ├── code.ts           # Logic chính chạy trong Figma sandbox (quét layer, lấy byte)
│   ├── ui.html           # Template HTML & CSS giao diện người dùng
│   └── ui.ts             # Logic giao diện (preview, tạo ZIP, sequencer, tải file)
├── dist/                 # Thư mục sau khi build (Figma đọc từ đây)
│   ├── code.js           # Bundle code Figma sandbox
│   └── ui.html           # Bundle UI đã được inline toàn bộ CSS + JS + Libraries
└── sample-assets/
    └── test_sample.gif   # File GIF mẫu để kéo thả test ngay lập tức
```
