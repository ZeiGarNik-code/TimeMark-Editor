import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOCRText, parseTimemarkOCR } from './ocrParser.js';

test('OCR parser extracts Vietnamese weekday, date, time, and multi-line location', () => {
  const parsed = parseTimemarkOCR('Thứ Bảy, 24 tháng 10, 2026\n08:35:12\nTrường Tiểu học Hoa Sen\nHòa Khánh, Đà Nẵng');
  assert.deepEqual(parsed.content, {
    weekday: 'Thứ Bảy',
    date: '24 tháng 10, 2026',
    time: '08:35:12',
    address: 'Trường Tiểu học Hoa Sen · Hòa Khánh, Đà Nẵng',
  });
  assert.equal(parsed.recognizedCount, 4);
});

test('OCR parser accepts numeric date/time and a plain English address', () => {
  const parsed = parseTimemarkOCR('Thu 2 24/10/2026\n8.05 AM\nNguyen Du Elementary School');
  assert.equal(parsed.content.weekday, 'Thứ Hai');
  assert.equal(parsed.content.date, '24/10/2026');
  assert.equal(parsed.content.time, '8:05 AM');
  assert.equal(parsed.content.address, 'Nguyen Du Elementary School');
});

test('OCR parser translates an English weekday and reads an English month date', () => {
  const parsed = parseTimemarkOCR('Saturday, October 24, 2026\n8:30 AM\nNguyen Du School, Da Nang');
  assert.equal(parsed.content.weekday, 'Thứ Bảy');
  assert.equal(parsed.content.date, 'October 24, 2026');
  assert.equal(parsed.content.time, '8:30 AM');
  assert.equal(parsed.content.address, 'Nguyen Du School, Da Nang');
});

test('OCR parser repairs common OCR spacing and Vietnamese weekday errors', () => {
  const parsed = parseTimemarkOCR('14 04\n22 Tháng 10, 2026\nTha Nam\n^Ạ `\nChợ Phú Nhuận, Cao Thang, Thành Phố Hồ Chí Minh,\nP. Phú Nhuận\nTimel\n100% Chân thực');
  assert.equal(parsed.content.time, '14:04');
  assert.equal(parsed.content.weekday, 'Thứ Năm');
  assert.equal(parsed.content.date, '22 Tháng 10, 2026');
  assert.equal(parsed.content.address, 'Chợ Phú Nhuận, Cao Thang, Thành Phố Hồ Chí Minh · P. Phú Nhuận');
  assert.equal(parseTimemarkOCR('Thir Nam').content.weekday, 'Thứ Năm');
});

test('OCR parser leaves uncertain fields blank and preserves raw text for review', () => {
  const raw = 'Góc sân trường\nkhông đọc rõ';
  const parsed = parseTimemarkOCR(raw);
  assert.deepEqual(parsed.content, { weekday: '', date: '', time: '', address: 'Góc sân trường · không đọc rõ' });
  assert.equal(parsed.lines.join('\n'), raw);
  assert.equal(normalizeOCRText('Thứ Tư · Đà Nẵng'), 'thu tu · da nang');
});
