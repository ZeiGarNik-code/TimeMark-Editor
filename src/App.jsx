import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorker, PSM } from 'tesseract.js';
import { parseTimemarkOCR } from './lib/ocrParser.js';
import { formatTimeToMinutes } from './lib/timeFormat.js';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  CloudOff,
  Download,
  Eye,
  FileImage,
  ImagePlus,
  Info,
  MapPin,
  Move,
  Pipette,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  detectAccentDivider,
  drawTimestamp,
  estimateTextMetrics,
  expandDetectedStampRegion,
  inferStampTypography,
  fallbackForCorner,
  inpaintInk,
  inpaintInkWithOpenCV,
  parseHexColor,
  scanCornerText,
} from './lib/imageProcessor.js';

const SAMPLE_PHOTO = {
  id: 'sample-photo',
  src: `${import.meta.env.BASE_URL}demo-school.jpg`,
  name: 'san-truong-mau.jpg',
  isSample: true,
};
const SAMPLE_REGION = { x: 0.565, y: 0.718, w: 0.402, h: 0.226, corner: 'bottom-right' };
const SAMPLE_OLD_CONTENT = {
  weekday: 'Thứ Năm',
  date: '12 tháng 06, 2025',
  time: '07:42',
  address: 'Trường THCS Trưng Vương',
};
const INITIAL_CONTENT = {
  weekday: 'Thứ Bảy',
  date: '24 tháng 10, 2026',
  time: '08:35',
  address: 'Trường Tiểu học Hoa Sen',
};
const INITIAL_STYLE = {
  color: '#ffffff',
  fontScale: 0.028,
  timeGlyphScale: 0.95,
  detailGlyphScale: 0.36,
  addressGlyphScale: 0.34,
  lineHeight: 1.18,
  detailLineHeight: 1.18,
  addressLineHeight: 1.08,
  detailGapRatio: 0.021,
  addressGapRatio: 0.30,
  textPaddingRatio: 0.036,
  align: 'left',
  weight: 400,
  timeWeight: 500,
  opacity: 1,
  shadow: true,
  fontFamily: '"Roboto Condensed", "Arial Narrow", Arial, sans-serif',
};
const WEB_TEST_CONTENT = {
  weekday: 'Chủ Nhật',
  date: '25 Tháng 10, 2026',
  time: '08:35',
  address: 'Chợ Bến Thành, Quận 1, TP. Hồ Chí Minh',
};
const WEB_TEST_CRITERIA = [
  { id: 'frame', label: 'Khung bao trọn chữ cũ và gạch cam', detail: 'Không cắt mất giờ, ngày, địa chỉ hoặc vạch màu.' },
  { id: 'ocr', label: 'OCR đọc đúng nội dung cần thiết', detail: 'Soát thứ, ngày, giờ và địa điểm trước khi áp dụng.' },
  { id: 'cleanup', label: 'Tẩy chữ cũ không để bóng/lem rõ', detail: 'Quan sát nền ở kích thước 100% quanh vùng chữ.' },
  { id: 'alignment', label: 'Chữ mới canh theo gạch cam', detail: 'Giờ bên trái; ngày/thứ bên phải; địa điểm bên dưới.' },
  { id: 'export', label: 'Ảnh xuất đúng kích thước và dùng được', detail: 'Tải PNG rồi mở lại để kiểm tra lần cuối.' },
];

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

let openCvPromise;
function loadOpenCV() {
  if (typeof window === 'undefined') return Promise.reject(new Error('OpenCV requires a browser.'));
  if (window.cv?.then) return window.cv;
  if (window.cv?.inpaint) return Promise.resolve(window.cv);
  if (openCvPromise) return openCvPromise;

  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  openCvPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${base}ocr/opencv.js`;
    script.async = true;
    script.onload = async () => {
      try {
        const cv = await window.cv;
        if (!cv?.inpaint || !cv?.matFromImageData) throw new Error('OpenCV image inpainting is unavailable.');
        resolve(cv);
      } catch (error) {
        openCvPromise = null;
        try { delete window.cv; } catch { /* The browser may expose this global as non-configurable. */ }
        script.remove();
        reject(error);
      }
    };
    script.onerror = () => {
      openCvPromise = null;
      script.remove();
      reject(new Error('Could not load local OpenCV assets.'));
    };
    document.head.appendChild(script);
  });
  return openCvPromise;
}

function expandOcrRegion(region, corner) {
  if (!corner.startsWith('bottom') || region.w >= 0.90) return region;
  const width = 0.90;
  const x = corner.endsWith('left') ? 0.015 : 1 - width - 0.015;
  const verticalPadding = region.h < 0.15 ? Math.max(0.045, Math.min(0.09, region.h * 0.71)) : 0;
  const y = Math.max(0, region.y - verticalPadding);
  const bottom = Math.min(1, region.y + region.h);
  return { ...region, x, y, w: Math.min(width, 1 - x), h: Math.max(0.03, bottom - y) };
}

function createOcrCrop(photo, region, inkColor) {
  const x = Math.max(0, Math.min(photo.width - 1, Math.round(region.x * photo.width)));
  const y = Math.max(0, Math.min(photo.height - 1, Math.round(region.y * photo.height)));
  const width = Math.max(1, Math.min(photo.width - x, Math.round(region.w * photo.width)));
  const height = Math.max(1, Math.min(photo.height - y, Math.round(region.h * photo.height)));
  const scale = Math.max(2, Math.min(3, 2200 / width));
  const crop = makeCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  const context = crop.getContext('2d', { willReadFrequently: true });
  context.drawImage(photo.sourceCanvas, x, y, width, height, 0, 0, crop.width, crop.height);
  const pixels = context.getImageData(0, 0, crop.width, crop.height);
  const inkLuma = inkColor.r * 0.2126 + inkColor.g * 0.7152 + inkColor.b * 0.0722;
  const lightInk = inkLuma >= 128;
  const threshold = lightInk ? 173 : 82;
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const gray = pixels.data[offset] * 0.2126 + pixels.data[offset + 1] * 0.7152 + pixels.data[offset + 2] * 0.0722;
    const ink = lightInk ? gray >= threshold : gray <= threshold;
    const value = ink ? 0 : 255;
    pixels.data[offset] = value;
    pixels.data[offset + 1] = value;
    pixels.data[offset + 2] = value;
    pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return crop;
}

function ocrStatusLabel(status) {
  if (status?.includes('language')) return 'Đang nạp mô hình tiếng Việt và tiếng Anh…';
  if (status?.includes('core')) return 'Đang tải bộ máy OCR…';
  if (status?.includes('initializ')) return 'Đang khởi tạo OCR…';
  if (status?.includes('recogniz')) return 'Đang đọc chữ trong vùng đã chọn…';
  return 'Đang chuẩn bị OCR…';
}

function drawRegionGuide(ctx, region, width, height) {
  if (!region) return;
  const x = Math.round(region.x * width);
  const y = Math.round(region.y * height);
  const w = Math.round(region.w * width);
  const h = Math.round(region.h * height);
  const line = Math.max(2, width / 1100);
  ctx.save();
  ctx.lineWidth = line;
  ctx.strokeStyle = '#58dfb0';
  ctx.setLineDash([line * 5, line * 3]);
  ctx.shadowColor = 'rgba(4, 18, 26, .75)';
  ctx.shadowBlur = line * 3;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#58dfb0';
  const handle = Math.max(5, line * 2.5);
  [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([px, py]) => {
    ctx.beginPath();
    ctx.arc(px, py, handle, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function cornerName(corner) {
  return {
    'top-left': 'Trên trái',
    'top-right': 'Trên phải',
    'bottom-left': 'Dưới trái',
    'bottom-right': 'Dưới phải',
  }[corner] ?? 'Dưới phải';
}

function getTodayContent() {
  const now = new Date();
  const weekdays = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  return {
    weekday: weekdays[now.getDay()],
    date: `${now.getDate()} tháng ${now.getMonth() + 1}, ${now.getFullYear()}`,
    time: new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now),
  };
}

function LogoMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span className="brand-mark-frame" />
      <span className="brand-mark-dot" />
      <span className="brand-mark-hand" />
    </div>
  );
}

function Brand({ compact = false, light = false }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''} ${light ? 'brand-light' : ''}`}>
      <LogoMark />
      {!compact && (
        <span className="brand-name">
          TimeMark<span> Studio</span>
        </span>
      )}
    </div>
  );
}

function EditorHeader({ onHelp }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-brand"><Brand compact /></div>
        <div className="breadcrumbs"><span>Không gian làm việc</span><span className="crumb-separator">/</span><b>Chỉnh sửa ảnh</b></div>
      </div>
      <div className="topbar-right">
        <div className="connection-pill"><span /> <span>Đang xử lý trên thiết bị</span></div>
        <button className="topbar-help" onClick={onHelp}><CircleHelp size={16} /><span>Hướng dẫn</span></button>
      </div>
    </header>
  );
}

function CornerButton({ corner, selected, onClick }) {
  return (
    <button className={`corner-button ${selected ? 'selected' : ''}`} onClick={onClick} aria-label={`Chọn góc ${cornerName(corner)}`} title={cornerName(corner)}>
      <span className={`corner-mini corner-${corner}`}><i /></span>
      <span>{cornerName(corner)}</span>
    </button>
  );
}

function RangeControl({ label, value, min, max, step, onChange, display, hint }) {
  const percent = ((Number(value) - Number(min)) / (Number(max) - Number(min))) * 100;
  return (
    <div className="range-control">
      <div className="range-heading"><label>{label}</label><span>{display}</span></div>
      <input className="range-input" type="range" min={min} max={max} step={step} value={value} style={{ '--range-progress': `${percent}%` }} onChange={(event) => onChange(Number(event.target.value))} />
      {hint && <small className="range-hint">{hint}</small>}
    </div>
  );
}

function SectionHeading({ icon: Icon, title, trailing }) {
  return <div className="section-heading"><div className="section-heading-title"><span className="section-icon"><Icon size={16} /></span><h3>{title}</h3></div>{trailing}</div>;
}

function WebTestPanel({
  onClose,
  onChooseImage,
  onLoadSample,
  onSetTestContent,
  onScan,
  onReadOCR,
  onResultChange,
  onResetResults,
  onCopyReport,
  photo,
  scanData,
  ocrBusy,
  ocrStatus,
  testResults,
  testNotes,
  onTestNotesChange,
}) {
  const passed = WEB_TEST_CRITERIA.filter(({ id }) => testResults[id] === 'pass').length;
  const failed = WEB_TEST_CRITERIA.filter(({ id }) => testResults[id] === 'fail').length;

  return (
    <section className="web-test-panel" id="web-test-panel" aria-labelledby="web-test-title">
      <header className="web-test-header">
        <div className="web-test-title-wrap">
          <span className="web-test-icon"><ClipboardCheck size={19} /></span>
          <div><span className="web-test-kicker">KIỂM THỬ TRÊN WEB</span><h2 id="web-test-title">Bộ test ảnh TimeMark</h2></div>
          <span className="web-test-local-badge"><i /> Chạy trên thiết bị</span>
        </div>
        <button type="button" className="mini-icon-button web-test-close" onClick={onClose} aria-label="Đóng bộ kiểm thử"><X size={17} /></button>
      </header>
      <div className="web-test-grid">
        <section className="web-test-setup" aria-label="Các bước kiểm thử">
          <div className="web-test-section-heading"><div><b>Chạy thử</b><small>Ảnh của bạn không được tải lên máy chủ.</small></div></div>
          <div className="web-test-step">
            <span className="web-test-step-number">01</span>
            <div className="web-test-step-body"><b>Mở ảnh để kiểm tra</b><small>{photo ? `${photo.name} · ${photo.width.toLocaleString('vi-VN')} × ${photo.height.toLocaleString('vi-VN')} px` : 'Chọn ảnh TimeMark hoặc dùng ảnh minh hoạ.'}</small>
              <div className="web-test-button-row"><button type="button" className="secondary-button" onClick={onChooseImage}><Upload size={14} /> Chọn ảnh của tôi</button><button type="button" className="secondary-button" onClick={onLoadSample}><RotateCcw size={14} /> Ảnh mẫu</button></div>
            </div>
          </div>
          <div className="web-test-step">
            <span className="web-test-step-number">02</span>
            <div className="web-test-step-body"><b>Thử khung và OCR</b><small>{scanData.message} · kiểm tra khung có phủ đủ gạch cam và chữ không.</small>
              <div className="web-test-button-row"><button type="button" className="secondary-button" onClick={onScan} disabled={!photo}><ScanSearch size={14} /> Quét khung</button><button type="button" className="primary-button" onClick={onReadOCR} disabled={!photo || ocrBusy}><ScanSearch size={14} /> {ocrBusy ? (ocrStatus || 'Đang đọc…') : 'Đọc OCR'}</button></div>
            </div>
          </div>
          <div className="web-test-step">
            <span className="web-test-step-number">03</span>
            <div className="web-test-step-body"><b>Thử thay nội dung</b><small>Preset để thử bố cục quanh gạch cam và địa điểm dài.</small>
              <div className="web-test-preset"><span><Clock3 size={13} /> 08:35 · Chủ Nhật, 25 Tháng 10, 2026</span><span><MapPin size={13} /> Chợ Bến Thành, Quận 1, TP. Hồ Chí Minh</span></div>
              <button type="button" className="secondary-button web-test-preset-button" onClick={onSetTestContent} disabled={!photo}><Check size={14} /> Nạp nội dung thử vào trình chỉnh sửa</button>
            </div>
          </div>
        </section>

        <section className="web-test-checklist" aria-label="Ghi nhận kết quả kiểm thử">
          <div className="web-test-section-heading web-test-checklist-heading"><div><b>Kết quả kiểm thử</b><small>{passed}/{WEB_TEST_CRITERIA.length} đạt{failed ? ` · ${failed} chưa đạt` : ''}</small></div><span className="web-test-score">{passed}/{WEB_TEST_CRITERIA.length}</span></div>
          <div className="web-test-criteria-list">
            {WEB_TEST_CRITERIA.map(({ id, label, detail }) => (
              <div className={`web-test-criteria ${testResults[id] ? `criteria-${testResults[id]}` : ''}`} key={id}>
                <div className="web-test-criteria-copy"><b>{label}</b><small>{detail}</small></div>
                <div className="web-test-result-buttons">
                  <button type="button" className={testResults[id] === 'pass' ? 'selected-pass' : ''} aria-pressed={testResults[id] === 'pass'} onClick={() => onResultChange(id, testResults[id] === 'pass' ? '' : 'pass')}><Check size={13} /> Đạt</button>
                  <button type="button" className={testResults[id] === 'fail' ? 'selected-fail' : ''} aria-pressed={testResults[id] === 'fail'} onClick={() => onResultChange(id, testResults[id] === 'fail' ? '' : 'fail')}><X size={13} /> Lỗi</button>
                </div>
              </div>
            ))}
          </div>
          <label className="web-test-notes-label" htmlFor="web-test-notes">Ghi chú / lỗi gặp phải</label>
          <textarea id="web-test-notes" className="web-test-notes" value={testNotes} onChange={(event) => onTestNotesChange(event.target.value)} placeholder="Ví dụ: còn bóng chữ ở dòng địa chỉ…" />
          <div className="web-test-footer-actions"><button type="button" className="secondary-button" onClick={onResetResults}><RotateCcw size={13} /> Xoá kết quả</button><button type="button" className="primary-button" onClick={onCopyReport}><ClipboardCheck size={14} /> Sao chép báo cáo</button></div>
        </section>
      </div>
      <div className="web-test-hint"><Info size={14} /><span>Sau khi đánh dấu checklist, hãy xem thử ảnh ở kích thước 100%, bấm “So sánh ảnh gốc” và tải PNG để kiểm tra bản xuất.</span></div>
    </section>
  );
}

function HelpModal({ onClose }) {
  useEffect(() => {
    const handleEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <button className="modal-close" onClick={onClose} aria-label="Đóng hướng dẫn"><X size={19} /></button>
        <div className="modal-kicker"><Sparkles size={15} /> BẮT ĐẦU TRONG 3 BƯỚC</div>
        <h2 id="help-title">Chỉnh ảnh của bạn</h2>
        <p className="modal-intro">Ứng dụng chạy ngay trên thiết bị. Hãy kiểm tra vùng chữ và ảnh xuất trước khi sử dụng.</p>
        <div className="help-steps">
          <div><span className="step-number">01</span><span><b>Mở ảnh</b><small>Tải ảnh TimeMark từ thiết bị hoặc dùng ảnh mẫu để thử.</small></span></div>
          <div><span className="step-number">02</span><span><b>Quét và đọc bằng OCR</b><small>Kiểm tra khung, đọc ngày giờ/địa điểm rồi xem kết quả trước khi áp dụng.</small></span></div>
          <div><span className="step-number">03</span><span><b>Nhập thông tin, rồi tải xuống</b><small>Ảnh xuất giữ nguyên kích thước gốc; PNG là lựa chọn không nén lại.</small></span></div>
        </div>
        <div className="help-note"><Info size={16} /><span>OCR tiếng Việt/Anh chạy cục bộ; kết quả nhận dạng có thể sai. Hãy soát lại thứ, ngày, giờ và địa chỉ trước khi áp dụng.</span></div>
        <button className="primary-button modal-done" onClick={onClose}>Đã hiểu <Check size={16} /></button>
      </section>
    </div>
  );
}

function App() {
  const [photoSelection, setPhotoSelection] = useState(SAMPLE_PHOTO);
  const [photo, setPhoto] = useState(null);
  const [region, setRegion] = useState(SAMPLE_REGION);
  const [corner, setCorner] = useState('bottom-right');
  const [scanData, setScanData] = useState({ confidence: 0.86, message: 'Ảnh mẫu · vùng được xác định sẵn' });
  const [content, setContent] = useState(INITIAL_CONTENT);
  const [style, setStyle] = useState(INITIAL_STYLE);
  const [styleMatchApplied, setStyleMatchApplied] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  const [eraseColor, setEraseColor] = useState('#ffffff');
  const [eraseTolerance, setEraseTolerance] = useState(74);
  const [eraseOld, setEraseOld] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [dragBox, setDragBox] = useState(null);
  const [isPickingColor, setIsPickingColor] = useState(false);
  const [cleanedRegion, setCleanedRegion] = useState(null);
  const [cleaningBusy, setCleaningBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const [ocrResult, setOcrResult] = useState(null);
  const [ocrError, setOcrError] = useState('');
  const [fileFormat, setFileFormat] = useState('png');
  const [toast, setToast] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [testResults, setTestResults] = useState({});
  const [testNotes, setTestNotes] = useState('');
  const [textScaled, setTextScaled] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const dragStartRef = useRef(null);
  const toastTimerRef = useRef(null);
  const ocrWorkerRef = useRef(null);
  const ocrRequestRef = useRef(0);
  const ocrLockRef = useRef(false);
  const styleMatchRequestRef = useRef(0);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3200);
  }, []);

  const invalidateOCR = () => {
    ocrRequestRef.current += 1;
    setOcrResult(null);
    setOcrError('');
  };

  useEffect(() => {
    let cancelled = false;
    const loadLocalStampFonts = async () => {
      try {
        if (document.fonts?.load) {
          await Promise.all([300, 400, 500, 700].map((weight) => document.fonts.load(
            `${weight} 48px "Roboto Condensed"`,
            'Thứ Năm, 24 tháng 10, 2026 · Phú Nhuận',
          )));
          await document.fonts.ready;
        }
      } catch {
        // System fallbacks remain available if the bundled webfont cannot load.
      }
      if (!cancelled) setFontReady(true);
    };
    void loadLocalStampFonts();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhoto(null);
    setCleanedRegion(null);
    setStyleMatchApplied(false);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (cancelled) return;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const cleanCanvas = makeCanvas(width, height);
      cleanCanvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0);
      const sourceCanvas = photoSelection.isSample ? makeCanvas(width, height) : cleanCanvas;
      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (photoSelection.isSample) sourceContext.drawImage(image, 0, 0);

      let initialRegion;
      if (photoSelection.isSample) {
        initialRegion = { ...SAMPLE_REGION };
        drawTimestamp(sourceContext, initialRegion, SAMPLE_OLD_CONTENT, INITIAL_STYLE, width, height);
        setScanData({ confidence: 0.92, message: 'Ảnh mẫu · vùng được xác định sẵn' });
      } else {
        const scale = Math.min(1, 700 / Math.max(width, height));
        const scanCanvas = makeCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
        const scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
        scanContext.drawImage(sourceCanvas, 0, 0, scanCanvas.width, scanCanvas.height);
        const scan = scanCornerText(scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height));
        if (scan.score > 0 && scan.confidence >= 0.37) {
          initialRegion = expandDetectedStampRegion(
            { x: scan.x, y: scan.y, w: scan.w, h: scan.h, corner: scan.corner },
            scan.corner,
          );
          setScanData({ confidence: scan.confidence, message: `Gợi ý ${cornerName(scan.corner).toLowerCase()} · hãy kiểm tra khung` });
        } else {
          initialRegion = { ...fallbackForCorner('bottom-right'), corner: 'bottom-right' };
          setScanData({ confidence: 0.28, message: 'Chưa nhận diện rõ · đặt lại khung để chính xác hơn' });
        }
      }

      if (!cancelled) {
        setPhoto({ width, height, name: photoSelection.name, isSample: photoSelection.isSample, cleanCanvas, sourceCanvas });
        setRegion(initialRegion);
        setCorner(initialRegion.corner ?? 'bottom-right');
        setCompareOriginal(false);
        setShowGuides(true);
      }
    };
    image.onerror = () => {
      if (!cancelled) notify('Không mở được ảnh này. Hãy thử tệp JPG, PNG hoặc WebP khác.');
    };
    image.src = photoSelection.src;
    return () => { cancelled = true; };
  }, [photoSelection.id, photoSelection.src, photoSelection.name, photoSelection.isSample, notify]);

  useEffect(() => {
    if (!photo || !region) {
      setCleaningBusy(false);
      return undefined;
    }
    let cancelled = false;
    setCleanedRegion(null);
    const x = Math.max(0, Math.min(photo.width - 1, Math.round(region.x * photo.width)));
    const y = Math.max(0, Math.min(photo.height - 1, Math.round(region.y * photo.height)));
    const width = Math.max(1, Math.min(photo.width - x, Math.round(region.w * photo.width)));
    const height = Math.max(1, Math.min(photo.height - y, Math.round(region.h * photo.height)));
    try {
      const cleanContext = photo.cleanCanvas.getContext('2d', { willReadFrequently: true });
      const sourceContext = photo.sourceCanvas.getContext('2d', { willReadFrequently: true });
      const shouldRestoreSample = photo.isSample && eraseOld;
      const originalPixels = (shouldRestoreSample ? cleanContext : sourceContext).getImageData(x, y, width, height);
      const divider = photo.isSample ? null : detectAccentDivider(originalPixels);
      if (photo.isSample || !eraseOld) {
        setCleaningBusy(false);
        setCleanedRegion({ x, y, pixels: originalPixels, divider });
      } else {
        setCleaningBusy(true);
        const inkColor = parseHexColor(eraseColor);
        loadOpenCV()
          .then((cv) => {
            if (cancelled) return;
            const pixels = inpaintInkWithOpenCV(originalPixels, inkColor, eraseTolerance, cv);
            setCleanedRegion({ x, y, pixels, divider });
          })
          .catch(() => {
            if (cancelled) return;
            setCleanedRegion({ x, y, pixels: inpaintInk(originalPixels, inkColor, eraseTolerance), divider });
            notify('Bộ tẩy nâng cao chưa tải được; đang dùng chế độ cơ bản. Kết nối mạng rồi thử lại để có kết quả sạch hơn.');
          })
          .finally(() => {
            if (!cancelled) setCleaningBusy(false);
          });
      }
    } catch {
      setCleaningBusy(false);
      notify('Không thể làm sạch vùng này trên trình duyệt. Hãy thu nhỏ khung hoặc dùng ảnh có kích thước thấp hơn.');
      setCleanedRegion(null);
    }
    return () => { cancelled = true; };
  }, [photo, region, eraseOld, eraseColor, eraseTolerance, notify]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !photo || !region) return;
    canvas.width = photo.width;
    canvas.height = photo.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, photo.width, photo.height);
    if (compareOriginal) {
      context.drawImage(photo.sourceCanvas, 0, 0);
      return;
    }
    if (dragBox) {
      context.drawImage(photo.sourceCanvas, 0, 0);
      drawRegionGuide(context, dragBox, photo.width, photo.height);
      return;
    }
    if (!cleanedRegion) {
      context.drawImage(photo.sourceCanvas, 0, 0);
      if (showGuides) drawRegionGuide(context, region, photo.width, photo.height);
      return;
    }
    context.drawImage(photo.sourceCanvas, 0, 0);
    context.putImageData(cleanedRegion.pixels, cleanedRegion.x, cleanedRegion.y);
    const layout = drawTimestamp(context, region, content, style, photo.width, photo.height, cleanedRegion.divider);
    setTextScaled(layout.scaled);
    if (showGuides) drawRegionGuide(context, region, photo.width, photo.height);
  }, [photo, region, content, style, cleanedRegion, compareOriginal, showGuides, dragBox, fontReady]);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);
  useEffect(() => () => { void ocrWorkerRef.current?.terminate(); }, []);

  useEffect(() => {
    const source = photoSelection.src;
    return () => { if (source.startsWith('blob:')) URL.revokeObjectURL(source); };
  }, [photoSelection.src]);

  const chooseFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('Vui lòng chọn tệp ảnh JPG, PNG hoặc WebP.');
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      notify('Tệp ảnh lớn hơn 80 MB. Hãy chọn ảnh nhỏ hơn để trình duyệt xử lý ổn định.');
      return;
    }
    invalidateOCR();
    if (photoSelection.src.startsWith('blob:')) URL.revokeObjectURL(photoSelection.src);
    const url = URL.createObjectURL(file);
    setPhotoSelection({ id: `${file.name}-${file.lastModified}-${Date.now()}`, src: url, name: file.name, isSample: false });
    setEraseColor('#ffffff');
    setCompareOriginal(false);
    setIsAdjusting(false);
    notify('Đã mở ảnh. Vùng chữ là gợi ý tự động — hãy kiểm tra trước khi tải xuống.');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleScan = () => {
    if (!photo) return;
    invalidateOCR();
    if (photo.isSample) {
      setRegion({ ...SAMPLE_REGION });
      setCorner('bottom-right');
      setScanData({ confidence: 0.92, message: 'Ảnh mẫu · vùng được xác định sẵn' });
      notify('Đã quét lại vùng mốc trên ảnh mẫu.');
      return;
    }
    const scale = Math.min(1, 700 / Math.max(photo.width, photo.height));
    const scanCanvas = makeCanvas(Math.max(1, Math.round(photo.width * scale)), Math.max(1, Math.round(photo.height * scale)));
    const scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
    scanContext.drawImage(photo.sourceCanvas, 0, 0, scanCanvas.width, scanCanvas.height);
    const scan = scanCornerText(scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height));
    if (scan.score <= 0 || scan.confidence < 0.37) {
      setScanData({ confidence: 0.28, message: 'Chưa nhận diện rõ · kéo để vẽ lại khung' });
      setRegion({ ...fallbackForCorner('bottom-right'), corner: 'bottom-right' });
      setCorner('bottom-right');
      notify('Chưa tìm thấy khối chữ rõ ràng. Hãy kéo trên ảnh để khoanh vùng chính xác.');
      return;
    }
    const next = expandDetectedStampRegion(
      { x: scan.x, y: scan.y, w: scan.w, h: scan.h, corner: scan.corner },
      scan.corner,
    );
    setRegion(next);
    setCorner(scan.corner);
    setScanData({ confidence: scan.confidence, message: `Gợi ý ${cornerName(scan.corner).toLowerCase()} · hãy kiểm tra khung` });
    setIsAdjusting(false);
    notify('Đã quét xong. Khung quét chỉ là gợi ý — hãy kiểm tra vị trí.');
  };

  const handleCanvasPointerDown = (event) => {
    if (!photo || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const point = {
      x: Math.min(0.999, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(0.999, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
    if (isPickingColor) {
      const x = Math.min(photo.width - 1, Math.max(0, Math.round(point.x * photo.width)));
      const y = Math.min(photo.height - 1, Math.max(0, Math.round(point.y * photo.height)));
      try {
        const pixel = photo.sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
        setEraseColor(rgbToHex(pixel[0], pixel[1], pixel[2]));
        notify('Đã lấy mẫu màu mực cũ từ ảnh.');
      } catch {
        notify('Không lấy được màu tại điểm này.');
      }
      setIsPickingColor(false);
      return;
    }
    if (isAdjusting) {
      dragStartRef.current = point;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDragBox({ x: point.x, y: point.y, w: 0, h: 0, corner });
    }
  };

  const handleCanvasPointerMove = (event) => {
    if (!dragStartRef.current || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const point = {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
    const start = dragStartRef.current;
    setDragBox({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), w: Math.abs(point.x - start.x), h: Math.abs(point.y - start.y), corner });
  };

  const handleCanvasPointerUp = (event) => {
    if (!dragStartRef.current || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const point = {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
    const start = dragStartRef.current;
    const next = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), w: Math.abs(point.x - start.x), h: Math.abs(point.y - start.y) };
    dragStartRef.current = null;
    setDragBox(null);
    setIsAdjusting(false);
    if (next.w < 0.025 || next.h < 0.025) {
      notify('Khung quá nhỏ. Hãy kéo một vùng rộng hơn quanh mốc thời gian.');
      return;
    }
    const horizontal = next.x + next.w / 2 < 0.5 ? 'left' : 'right';
    const vertical = next.y + next.h / 2 < 0.5 ? 'top' : 'bottom';
    next.corner = `${vertical}-${horizontal}`;
    invalidateOCR();
    setRegion(next);
    setCorner(next.corner);
    setScanData({ confidence: 1, message: 'Vùng được chọn thủ công' });
    notify('Đã cập nhật vùng quét.');
  };

  const selectCorner = (nextCorner) => {
    invalidateOCR();
    const next = fallbackForCorner(nextCorner, Math.min(region?.w ?? 0.4, 0.72), Math.min(region?.h ?? 0.25, 0.55));
    setRegion({ ...next, corner: nextCorner });
    setCorner(nextCorner);
    setScanData({ confidence: 1, message: `Vị trí đã chuyển sang ${cornerName(nextCorner).toLowerCase()}` });
  };

  const updateContent = (key, value) => setContent((current) => ({
    ...current,
    [key]: key === 'time' ? formatTimeToMinutes(value) : value,
  }));
  const updateStyle = (key, value) => setStyle((current) => ({
    ...current,
    [key]: value,
    ...(key === 'lineHeight' ? { detailLineHeight: value, addressLineHeight: value } : {}),
    ...(key === 'weight' ? { timeWeight: value } : {}),
  }));

  const matchOriginalStyle = useCallback(async ({ quiet = false, automatic = false } = {}) => {
    if (!photo || !region) return false;
    const requestId = ++styleMatchRequestRef.current;
    try {
      const x = Math.max(0, Math.round(region.x * photo.width));
      const y = Math.max(0, Math.round(region.y * photo.height));
      const width = Math.max(1, Math.min(photo.width - x, Math.round(region.w * photo.width)));
      const height = Math.max(1, Math.min(photo.height - y, Math.round(region.h * photo.height)));
      const pixels = photo.sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, width, height);
      const inkColor = parseHexColor(eraseColor);
      const typography = inferStampTypography(pixels, inkColor);
      if (typography) {
        if (typography.fontFamily.includes('Roboto Condensed') && document.fonts?.load) {
          try {
            await Promise.all([...new Set([typography.weight, typography.timeWeight ?? typography.weight])].map((weight) => document.fonts.load(
              `${weight} 48px "Roboto Condensed"`,
              'Thứ Năm, 24 tháng 10, 2026 · Phú Nhuận',
            )));
            await document.fonts.ready;
          } catch {
            // Keep the matched geometry and let the browser use the bundled font fallback stack.
          }
        }
        if (requestId !== styleMatchRequestRef.current) return false;
        setStyle((current) => ({
          ...current,
          color: eraseColor,
          fontFamily: typography.fontFamily,
          weight: typography.weight,
          timeWeight: typography.timeWeight,
          fontScale: 0.028,
          timeGlyphScale: typography.timeGlyphScale,
          detailGlyphScale: typography.detailGlyphScale,
          addressGlyphScale: typography.addressGlyphScale,
          lineHeight: 1.18,
          detailLineHeight: typography.detailLineHeight,
          addressLineHeight: typography.addressLineHeight,
          detailPitchScale: typography.detailPitchScale,
          addressPitchScale: typography.addressPitchScale,
          detailGapRatio: typography.detailGapRatio,
          addressGapRatio: typography.addressGapRatio,
          textPaddingRatio: typography.textPaddingRatio,
          sourceWidths: typography.sourceWidths,
          sourcePositions: typography.sourcePositions,
          align: typography.align,
          opacity: typography.opacity,
          shadow: typography.shadow,
        }));
        setStyleMatchApplied(true);
        if (!quiet) notify('Đã tự khớp font, độ đậm, cỡ chữ và khoảng cách theo gạch cam.');
        return true;
      }

      setStyleMatchApplied(false);
      if (automatic) return false;
      const metrics = estimateTextMetrics(pixels, inkColor);
      if (!metrics) {
        if (!quiet) notify('Chưa tìm được nét chữ màu này trong vùng. Hãy lấy mẫu đúng màu chữ cũ trước.');
        return false;
      }
      setStyle((current) => ({
        ...current,
        color: eraseColor,
        fontScale: Math.min(0.046, Math.max(0.016, metrics.fontPixels / photo.height)),
        lineHeight: metrics.lineHeight ?? current.lineHeight,
        align: metrics.align,
      }));
      if (!quiet) notify(`Đã khớp gần đúng cỡ chữ và căn lề từ ${metrics.lineCount} dòng gốc.`);
      return true;
    } catch {
      if (!quiet) notify('Không phân tích được phong cách trong vùng này. Hãy kiểm tra lại khung quét.');
      return false;
    }
  }, [photo, region, eraseColor, notify]);

  useEffect(() => {
    if (!photo || photo.isSample || !region) {
      setStyleMatchApplied(false);
      return undefined;
    }
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      if (active) void matchOriginalStyle({ quiet: true, automatic: true });
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      styleMatchRequestRef.current += 1;
    };
  }, [photo, region, eraseColor, matchOriginalStyle]);

  const handleReadOCR = async () => {
    if (!photo || !region || ocrLockRef.current) return;
    ocrLockRef.current = true;
    const requestId = ++ocrRequestRef.current;
    setOcrBusy(true);
    setOcrProgress(0);
    setOcrStatus('Đang chuẩn bị OCR…');
    setOcrError('');
    setOcrResult(null);

    try {
      let worker = ocrWorkerRef.current;
      if (!worker) {
        const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
        const root = `${base}ocr`;
        worker = await createWorker(['vie', 'eng'], undefined, {
          workerPath: `${root}/worker.min.js`,
          corePath: `${root}/core`,
          langPath: `${root}/lang`,
          gzip: true,
          cachePath: 'timemark-ocr-v1',
          cacheMethod: 'write',
          workerBlobURL: false,
          logger: (message) => {
            if (requestId !== ocrRequestRef.current) return;
            if (message.status) setOcrStatus(ocrStatusLabel(message.status));
            if (Number.isFinite(message.progress)) setOcrProgress(Math.round(message.progress * 100));
          },
        });
        ocrWorkerRef.current = worker;
      }
      if (requestId !== ocrRequestRef.current) return;

      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });
      setOcrStatus('Đang đọc chữ trong vùng đã chọn…');
      setOcrProgress(0);
      const ocrRegion = scanData.message.startsWith('Gợi ý') ? expandOcrRegion(region, corner) : region;
      const result = await worker.recognize(createOcrCrop(photo, ocrRegion, parseHexColor(eraseColor)));
      if (requestId !== ocrRequestRef.current) return;
      const parsed = parseTimemarkOCR(result.data.text);
      setOcrResult({
        rawText: String(result.data.text ?? '').trim(),
        content: parsed.content,
        recognizedCount: parsed.recognizedCount,
        confidence: Math.max(0, Math.min(100, Math.round(result.data.confidence ?? 0))),
      });
      setOcrProgress(100);
      setOcrStatus('Đã đọc xong');
      if (parsed.recognizedCount) notify(`OCR đã tìm được ${parsed.recognizedCount} trường. Hãy kiểm tra trước khi áp dụng.`);
      else notify('OCR chưa nhận ra nội dung trong vùng này. Hãy chỉnh khung sát chữ và thử lại.');
    } catch {
      if (requestId === ocrRequestRef.current) {
        setOcrError('Không khởi chạy được OCR. Hãy thử tải lại trang khi đang có kết nối mạng.');
        setOcrStatus('OCR gặp sự cố');
        notify('OCR chưa chạy được. Hãy kiểm tra kết nối hoặc thử lại sau.');
      }
    } finally {
      ocrLockRef.current = false;
      setOcrBusy(false);
    }
  };

  const applyOCRResult = () => {
    if (!ocrResult?.recognizedCount) return;
    setContent((current) => ({
      ...current,
      ...Object.fromEntries(Object.entries(ocrResult.content).filter(([, value]) => String(value ?? '').trim())),
    }));
    notify(`Đã áp dụng ${ocrResult.recognizedCount} trường OCR. Vui lòng soát lại thông tin.`);
  };

  const downloadImage = async () => {
    if (!photo || !cleanedRegion || !region || exporting) return;
    setExporting(true);
    try {
      const output = makeCanvas(photo.width, photo.height);
      const outputContext = output.getContext('2d');
      outputContext.drawImage(photo.sourceCanvas, 0, 0);
      outputContext.putImageData(cleanedRegion.pixels, cleanedRegion.x, cleanedRegion.y);
      drawTimestamp(outputContext, region, content, style, photo.width, photo.height, cleanedRegion.divider);
      const mimeType = fileFormat === 'jpg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise((resolve) => output.toBlob(resolve, mimeType, 0.97));
      if (!blob) throw new Error('Could not export image');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const basename = (photo.name || 'anh-timemark').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '-');
      anchor.href = url;
      anchor.download = `${basename || 'anh-timemark'}-da-chinh.${fileFormat === 'jpg' ? 'jpg' : 'png'}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`Đã tải ảnh ${photo.width} × ${photo.height}px · ${fileFormat.toUpperCase()}.`);
    } catch {
      notify('Chưa thể xuất ảnh. Hãy thử lại hoặc chọn ảnh có kích thước nhỏ hơn.');
    } finally {
      setExporting(false);
    }
  };

  const useCurrentTime = () => {
    const now = getTodayContent();
    setContent((current) => ({ ...current, ...now }));
    notify('Đã điền ngày và giờ hiện tại của thiết bị.');
  };

  const loadSample = () => {
    invalidateOCR();
    if (photoSelection.src.startsWith('blob:')) URL.revokeObjectURL(photoSelection.src);
    setPhotoSelection(SAMPLE_PHOTO);
    setContent(INITIAL_CONTENT);
    setStyle(INITIAL_STYLE);
    setEraseColor('#ffffff');
    setEraseOld(true);
    setCompareOriginal(false);
    setFileFormat('png');
    notify('Đã mở ảnh mẫu. Hãy thử thay đổi ngày giờ và địa chỉ.');
  };

  const setTestContent = () => {
    setContent(WEB_TEST_CONTENT);
    setCompareOriginal(false);
    notify('Đã nạp bộ nội dung thử. Kiểm tra cách chữ mới canh theo gạch cam.');
  };

  const updateTestResult = (id, result) => {
    setTestResults((current) => {
      const next = { ...current };
      if (result) next[id] = result;
      else delete next[id];
      return next;
    });
  };

  const resetTestResults = () => {
    setTestResults({});
    setTestNotes('');
  };

  const copyTestReport = async () => {
    const statusLabel = (result) => result === 'pass' ? 'ĐẠT' : result === 'fail' ? 'LỖI' : 'CHƯA THỬ';
    const report = [
      'TimeMark Editor — Báo cáo kiểm thử trên web',
      `Ngày giờ: ${new Date().toLocaleString('vi-VN')}`,
      `Ảnh: ${photo?.name ?? 'Chưa mở ảnh'}`,
      '',
      ...WEB_TEST_CRITERIA.map(({ id, label }) => `${statusLabel(testResults[id])} — ${label}`),
      '',
      `Ghi chú: ${testNotes.trim() || 'Không có'}`,
    ].join('\n');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(report);
      notify('Đã sao chép báo cáo kiểm thử vào clipboard.');
    } catch {
      const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'timemark-web-test-report.txt';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Trình duyệt không cho sao chép; đã tải báo cáo kiểm thử dạng TXT.');
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Brand /></div>
        <div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav className="side-nav" aria-label="Điều hướng chính">
          <button className={`side-nav-item ${!testPanelOpen ? 'active' : ''}`} onClick={() => setTestPanelOpen(false)}><span className="nav-icon"><ImagePlus size={18} /></span><span>Chỉnh sửa ảnh</span>{!testPanelOpen && <span className="nav-current-dot" />}</button>
          <button className={`side-nav-item ${testPanelOpen ? 'active' : ''}`} onClick={() => setTestPanelOpen((open) => !open)} title="Kiểm thử trên web"><span className="nav-icon"><ClipboardCheck size={18} /></span><span>Kiểm thử trên web</span>{testPanelOpen && <span className="nav-current-dot" />}</button>
          <button className="side-nav-item" onClick={() => setHelpOpen(true)}><span className="nav-icon"><CircleHelp size={18} /></span><span>Hướng dẫn nhanh</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <div className="privacy-card-icon"><ShieldCheck size={17} /></div>
            <div><b>Không cần tài khoản</b><span>Ảnh xử lý trực tiếp trên máy</span></div>
            <span className="privacy-status-dot" />
          </div>
        </div>
      </aside>

      <main className="app-main">
        <EditorHeader onHelp={() => setHelpOpen(true)} />
        <div className="main-content">
          <div className="editor-title-row">
            <div>
              <div className="title-eyebrow"><span className="eyebrow-dot" /> STUDIO CHỈNH SỬA ẢNH</div>
              <h1>Chỉnh ảnh TimeMark</h1>
              <p>Thay mốc thời gian, giữ nguyên khung hình và chất lượng ảnh gốc.</p>
            </div>
            <div className="title-actions">
              <button className={`secondary-button web-test-title-button ${testPanelOpen ? 'is-active' : ''}`} onClick={() => setTestPanelOpen((open) => !open)} aria-expanded={testPanelOpen} aria-controls="web-test-panel" aria-label="Bật/tắt kiểm thử trên web" title="Kiểm thử trên web"><ClipboardCheck size={16} /> <span>Kiểm thử</span></button>
              <button className="secondary-button" onClick={loadSample}><RotateCcw size={16} /> <span>Ảnh mẫu</span></button>
              <button className="primary-button upload-top-button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> <span>Chọn ảnh</span></button>
            </div>
          </div>

          {testPanelOpen && (
            <WebTestPanel
              onClose={() => setTestPanelOpen(false)}
              onChooseImage={() => fileInputRef.current?.click()}
              onLoadSample={loadSample}
              onSetTestContent={setTestContent}
              onScan={handleScan}
              onReadOCR={handleReadOCR}
              onResultChange={updateTestResult}
              onResetResults={resetTestResults}
              onCopyReport={copyTestReport}
              photo={photo}
              scanData={scanData}
              ocrBusy={ocrBusy}
              ocrStatus={ocrStatus}
              testResults={testResults}
              testNotes={testNotes}
              onTestNotesChange={setTestNotes}
            />
          )}

          <div className="editor-layout">
            <section className="preview-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); }}>
              <div className="preview-panel-header">
                <div className="file-info">
                  <div className="file-info-icon"><FileImage size={18} /></div>
                  <div className="file-info-copy"><div><b>{photo?.name ?? photoSelection.name}</b>{photo?.isSample && <span className="sample-badge">ẢNH MẪU</span>}</div><small>{photo ? `${photo.width.toLocaleString('vi-VN')} × ${photo.height.toLocaleString('vi-VN')} px` : 'Đang mở ảnh…'}</small></div>
                </div>
                <div className="preview-header-actions">
                  <button className={`original-toggle ${compareOriginal ? 'is-active' : ''}`} onClick={() => setCompareOriginal(!compareOriginal)} disabled={!photo} title="Xem ảnh gốc"><Eye size={15} /><span>{compareOriginal ? 'Đang xem ảnh gốc' : 'So sánh ảnh gốc'}</span></button>
                  <button className="icon-button preview-reload" onClick={handleScan} disabled={!photo} aria-label="Quét lại vùng chữ" title="Quét lại vùng chữ"><ScanSearch size={17} /></button>
                </div>
              </div>

              <div className={`image-stage ${isAdjusting ? 'is-adjusting' : ''} ${isPickingColor ? 'is-picking' : ''}`}>
                {photo ? (
                  <div className="canvas-wrap">
                    <canvas
                      ref={canvasRef}
                      className="photo-canvas"
                      aria-label="Ảnh xem trước đã chỉnh sửa"
                      onPointerDown={handleCanvasPointerDown}
                      onPointerMove={handleCanvasPointerMove}
                      onPointerUp={handleCanvasPointerUp}
                      onPointerCancel={handleCanvasPointerUp}
                    />
                    {(isAdjusting || isPickingColor) && <div className="stage-interaction-hint">{isPickingColor ? <><Pipette size={14} /> Chọn một điểm trên màu chữ cũ</> : <><Move size={14} /> Kéo để khoanh lại vùng mốc thời gian</>}</div>}
                  </div>
                ) : (
                  <div className="loading-image"><div className="loading-spinner" /><span>Đang tải ảnh…</span></div>
                )}
                <div className="stage-bottom-left"><span className="stage-check"><Check size={12} /></span> {compareOriginal ? 'Ảnh gốc · chưa thay đổi' : 'Xem trước bản chỉnh sửa'}</div>
                <div className="stage-bottom-right"><span className="stage-resolution-dot" /> Giữ nguyên kích thước</div>
              </div>

              <div className="preview-toolbar">
                <div className="region-status">
                  <span className="region-status-icon"><ScanSearch size={15} /></span>
                  <span><b>Vùng chữ: {cornerName(corner).toLowerCase()}</b><small>{scanData.message}</small></span>
                </div>
                <div className="preview-toolbar-actions">
                  <button className={`toolbar-button ${isAdjusting ? 'toolbar-button-on' : ''}`} onClick={() => { setCompareOriginal(false); setIsPickingColor(false); setIsAdjusting(!isAdjusting); setDragBox(null); }} disabled={!photo}><Move size={15} /> {isAdjusting ? 'Đang vẽ khung…' : 'Điều chỉnh vùng'}</button>
                  <button className="toolbar-button toolbar-scan" onClick={handleScan} disabled={!photo}><ScanSearch size={15} /> Quét lại</button>
                </div>
              </div>
              {textScaled && !compareOriginal && <div className="fit-warning"><Info size={14} /> Một dòng dài hơn khung — cỡ chữ được thu nhỏ để vừa vùng đã chọn.</div>}
            </section>

            <aside className="inspector-panel">
              <div className="inspector-heading">
                <div><span className="inspector-kicker">THÔNG TIN HIỂN THỊ</span><h2>Nội dung trên ảnh</h2></div>
                <span className="line-count">{[content.weekday, content.date, content.time, content.address].filter((line) => String(line ?? '').trim()).length.toString().padStart(2, '0')} dòng</span>
              </div>
              <div className="inspector-scroll">
                <div className="content-section">
                  <div className="field-pair">
                    <div className="editor-field"><label htmlFor="weekday"><CalendarDays size={14} /> Thứ</label><input id="weekday" value={content.weekday} onChange={(event) => updateContent('weekday', event.target.value)} placeholder="Thứ Hai" /></div>
                    <div className="editor-field"><label htmlFor="date">Ngày</label><input id="date" value={content.date} onChange={(event) => updateContent('date', event.target.value)} placeholder="24 tháng 10, 2026" /></div>
                  </div>
                  <div className="editor-field time-field"><label htmlFor="time"><Clock3 size={14} /> Giờ · HH:MM</label><div className="field-action-wrap"><input id="time" type="time" step="60" value={formatTimeToMinutes(content.time)} onChange={(event) => updateContent('time', event.target.value)} aria-label="Giờ, chỉ gồm giờ và phút" /><button className="field-inline-action" onClick={useCurrentTime} title="Dùng ngày giờ hiện tại"><RotateCcw size={14} /><span>Bây giờ</span></button></div></div>
                  <div className="editor-field address-field"><label htmlFor="address"><MapPin size={14} /> Địa chỉ / địa điểm</label><input id="address" value={content.address} onChange={(event) => updateContent('address', event.target.value)} placeholder="Tên trường hoặc địa chỉ" /></div>
                </div>

                <div className="inspector-divider" />

                <section className="inspector-section">
                  <SectionHeading icon={ScanSearch} title="Vị trí mốc chữ" trailing={<button className="mini-icon-button" title="Quét lại ảnh" onClick={handleScan}><RotateCcw size={15} /></button>} />
                  <div className="scan-result-card">
                    <div className="scan-result-icon"><ScanSearch size={17} /></div>
                    <div className="scan-result-copy"><b>{scanData.message.toLowerCase().includes('thủ công') ? 'Đã khoanh vùng thủ công' : scanData.message.toLowerCase().includes('chuyển') ? 'Vị trí đã chọn' : scanData.confidence >= 0.65 ? 'Đã tìm thấy vùng chữ' : 'Vùng gợi ý'}</b><span>{scanData.message}</span></div>
                    <span className={`scan-confidence ${scanData.confidence < 0.4 ? 'scan-low' : ''}`}>{Math.round(scanData.confidence * 100)}%</span>
                  </div>
                  <div className="ocr-tool">
                    <button className="ocr-run-button" onClick={handleReadOCR} disabled={!photo || ocrBusy} aria-busy={ocrBusy}>
                      <span className="ocr-run-icon">{ocrBusy ? <span className="loading-spinner small-spinner" /> : <ScanSearch size={17} />}</span>
                      <span className="ocr-run-copy"><b>{ocrBusy ? 'Đang đọc ảnh…' : 'Đọc nội dung bằng OCR'}</b><small>{ocrBusy ? ocrStatus : 'Tiếng Việt + English · vùng đã chọn'}</small></span>
                      <span className="ocr-run-action">{ocrBusy ? `${ocrProgress}%` : <ArrowRight size={15} />}</span>
                    </button>
                    {ocrBusy && <div className="ocr-progress-track"><i style={{ width: `${Math.max(4, ocrProgress)}%` }} /></div>}
                    {!ocrBusy && !ocrResult && !ocrError && <p className="ocr-privacy-note"><ShieldCheck size={13} /> OCR chạy cục bộ; lần đầu cần nạp mô hình tiếng Việt/Anh.</p>}
                    {ocrError && <div className="ocr-error-card" role="alert"><Info size={14} />{ocrError}</div>}
                    {ocrResult && <div className="ocr-result-card">
                      <div className="ocr-result-heading"><span><b>Kết quả nhận dạng</b><small>Độ tin cậy {ocrResult.confidence}%</small></span><button className="mini-icon-button" aria-label="Đóng kết quả OCR" onClick={() => setOcrResult(null)}><X size={14} /></button></div>
                      {ocrResult.rawText ? <pre className="ocr-raw-text">{ocrResult.rawText}</pre> : <p className="ocr-no-text">Chưa nhận ra chữ rõ ràng trong vùng này.</p>}
                      <div className="ocr-fields-preview">{[
                        ['Thứ', ocrResult.content.weekday],
                        ['Ngày', ocrResult.content.date],
                        ['Giờ', ocrResult.content.time],
                        ['Địa điểm', ocrResult.content.address],
                      ].map(([label, value]) => <div key={label}><b>{label}</b><span className={value ? '' : 'ocr-empty-value'}>{value || 'Chưa nhận dạng'}</span></div>)}</div>
                      <button className="ocr-apply-button" onClick={applyOCRResult} disabled={!ocrResult.recognizedCount}><Check size={14} /> Áp dụng kết quả đã đọc</button>
                    </div>}
                  </div>
                  <div className="corner-grid" aria-label="Chọn vị trí góc">
                    {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((item) => <CornerButton key={item} corner={item} selected={corner === item} onClick={() => selectCorner(item)} />)}
                  </div>
                  <button className="sampling-button" onClick={() => { setCompareOriginal(false); setIsAdjusting(false); setIsPickingColor(true); notify('Chạm vào màu chữ cũ trên ảnh để lấy mẫu.'); }} disabled={!photo}><Pipette size={15} /><span>Lấy màu mực cũ từ ảnh</span><ArrowRight size={14} /></button>
                  <label className="toggle-row">
                    <span className="toggle-copy"><b>Xoá nét chữ cũ</b><small>{cleaningBusy ? 'Đang phục hồi nền quanh nét chữ…' : 'Làm sạch mực cũ trong vùng quét'}</small></span>
                    <input type="checkbox" checked={eraseOld} onChange={(event) => setEraseOld(event.target.checked)} />
                    <span className="toggle-track" aria-hidden="true"><i /></span>
                  </label>
                  {eraseOld && !photo?.isSample && <RangeControl label="Độ nhạy khi xoá" min={30} max={140} step={2} value={eraseTolerance} onChange={setEraseTolerance} display={`${eraseTolerance}`} hint="Tăng nhẹ nếu nét chữ cũ còn sót." />}
                </section>

                <div className="inspector-divider" />

                <section className="inspector-section style-section">
                  <SectionHeading icon={SlidersHorizontal} title="Phong cách chữ" trailing={<button className="auto-style-badge style-match-button" title={styleMatchApplied ? 'Phân tích lại kiểu chữ từ ảnh gốc' : 'Tự động phân tích khi phát hiện gạch cam'} onClick={() => { void matchOriginalStyle(); }}><Sparkles size={12} /> {styleMatchApplied ? 'Khớp lại' : 'Khớp ảnh gốc'}</button>} />
                  {styleMatchApplied && <div className="style-match-note"><Sparkles size={13} /> Tự chọn font, độ đậm, cỡ và giãn dòng theo gạch cam.</div>}
                  <div className="style-color-row">
                    <div className="style-color-label"><span className="color-swatch" style={{ background: style.color }} /><span><b>Màu chữ mới</b><small>Áp dụng cho 4 dòng</small></span></div>
                    <label className="color-picker" title="Chọn màu chữ mới"><input type="color" value={style.color} onChange={(event) => updateStyle('color', event.target.value)} /><span>{style.color.toUpperCase()}</span><ChevronDown size={13} /></label>
                  </div>
                  <RangeControl label="Tỉ lệ cỡ chữ" min={0.016} max={0.046} step={0.001} value={style.fontScale} onChange={(value) => updateStyle('fontScale', value)} display={`${Math.round(style.fontScale / 0.028 * 100)}%`} hint="Từng trường được tự tính riêng; thanh này phóng to/thu nhỏ toàn bộ." />
                  <RangeControl label="Khoảng cách dòng" min={1.0} max={1.5} step={0.01} value={style.lineHeight} onChange={(value) => updateStyle('lineHeight', value)} display={`${style.lineHeight.toFixed(2)}×`} />
                  <div className="style-options-row">
                    <div className="align-picker" aria-label="Căn lề chữ">
                      <button className={style.align === 'left' ? 'selected' : ''} onClick={() => updateStyle('align', 'left')} aria-label="Căn trái"><AlignLeft size={15} /></button>
                      <button className={style.align === 'center' ? 'selected' : ''} onClick={() => updateStyle('align', 'center')} aria-label="Căn giữa"><AlignCenter size={15} /></button>
                      <button className={style.align === 'right' ? 'selected' : ''} onClick={() => updateStyle('align', 'right')} aria-label="Căn phải"><AlignRight size={15} /></button>
                    </div>
                    <button className={`text-style-chip ${style.weight >= 700 ? 'chip-selected' : ''}`} onClick={() => updateStyle('weight', style.weight >= 700 ? 400 : 700)}><b>B</b> Đậm</button>
                    <button className={`text-style-chip ${style.shadow ? 'chip-selected' : ''}`} onClick={() => updateStyle('shadow', !style.shadow)}><span className="shadow-aa">Aa</span> Bóng</button>
                  </div>
                  <RangeControl label="Độ đậm màu" min={0.45} max={1} step={0.01} value={style.opacity} onChange={(value) => updateStyle('opacity', value)} display={`${Math.round(style.opacity * 100)}%`} />
                </section>

                <div className="inspector-divider" />

                <section className="inspector-section export-section">
                  <SectionHeading icon={Download} title="Tải ảnh đã chỉnh" />
                  <div className="export-format-row"><label htmlFor="format">Định dạng</label><div className="select-wrap"><select id="format" value={fileFormat} onChange={(event) => setFileFormat(event.target.value)}><option value="png">PNG · giữ chất lượng</option><option value="jpg">JPG · 97%</option></select><ChevronDown size={14} /></div></div>
                  <div className="export-info"><ShieldCheck size={14} /><span>Không thay đổi kích thước ảnh gốc</span></div>
                  <button className="primary-button download-button" onClick={downloadImage} disabled={!photo || !cleanedRegion || exporting}>{exporting ? <span className="loading-spinner small-spinner" /> : <ArrowDownToLine size={17} />}<span>{exporting ? 'Đang xuất ảnh…' : 'Tải ảnh xuống'}</span></button>
                  <p className="export-footnote">Ảnh chỉ được tải về thiết bị này, không lưu trên máy chủ.</p>
                </section>
              </div>
            </aside>
          </div>

          <div className="page-footnote"><span><CloudOff size={14} /> Có thể dùng ngoại tuyến sau lần mở đầu tiên</span><span>Ảnh đang mở: <b>{photo?.isSample ? 'bản mẫu' : photo?.name ?? '—'}</b></span></div>
        </div>
      </main>

      <input ref={fileInputRef} className="file-input-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0])} />
      {toast && <div className="toast-message" role="status"><span className="toast-check"><Check size={13} /></span>{toast}</div>}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

export default App;
