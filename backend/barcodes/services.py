import base64
import io

from django.conf import settings
from django.core.files.base import ContentFile

from barcodes.models import Barcode

try:
    from barcode import Code128
    from barcode.writer import ImageWriter
except ImportError:  # pragma: no cover
    Code128 = None
    ImageWriter = None


def build_barcode_value(entity_type: str, barcode_id: int) -> str:
    prefix = {'BATCH': 'B', 'UNIT': 'U', 'RACK': 'R'}.get(entity_type, 'X')
    return f'{prefix}{barcode_id:010d}'


def create_barcode(entity_type: str, entity_id: int, label_data: dict | None = None) -> Barcode:
    barcode = Barcode.objects.create(
        value=f'TMP-{entity_type}-{entity_id}',
        entity_type=entity_type,
        entity_id=entity_id,
        label_data=label_data or {},
    )
    barcode.value = build_barcode_value(entity_type, barcode.id)
    barcode.save(update_fields=['value'])
    return barcode


def label_payload(*, item_name, item_code, grn_number='', batch_or_unit='', quantity=None):
    data = {
        'company_name': settings.COMPANY_NAME,
        'item_name': item_name,
        'item_code': item_code,
        'grn_number': grn_number,
        'batch_or_unit': batch_or_unit,
    }
    if quantity is not None:
        data['quantity'] = str(quantity)
    return data


def render_code128_png_bytes(value: str) -> bytes:
    """Render a Code 128 barcode PNG for the given value."""
    if Code128 is None or ImageWriter is None:
        raise RuntimeError('python-barcode is not installed')
    buffer = io.BytesIO()
    writer = ImageWriter()
    code = Code128(value, writer=writer)
    code.write(
        buffer,
        options={
            'module_width': 0.3,
            'module_height': 12.0,
            'quiet_zone': 2.0,
            'font_size': 10,
            'text_distance': 4.0,
            'write_text': True,
        },
    )
    return buffer.getvalue()


def render_label_png_bytes(barcode: Barcode) -> bytes:
    """Render a warehouse label: company/item fields + Code 128 symbol."""
    from PIL import Image, ImageDraw, ImageFont

    symbol = render_code128_png_bytes(barcode.value)
    symbol_img = Image.open(io.BytesIO(symbol)).convert('RGB')

    label_data = barcode.label_data or {}
    lines = [
        str(label_data.get('company_name') or settings.COMPANY_NAME),
        str(label_data.get('item_name') or ''),
        f"Code: {label_data.get('item_code') or ''}",
        f"GRN: {label_data.get('grn_number') or ''}",
        f"Batch/Unit: {label_data.get('batch_or_unit') or ''}",
    ]
    if label_data.get('quantity') is not None:
        lines.append(f"Qty: {label_data.get('quantity')}")
    lines = [line for line in lines if line and not line.endswith(': ')]

    padding = 16
    text_height = 22 * max(len(lines), 1)
    width = max(symbol_img.width + padding * 2, 360)
    height = padding + text_height + 8 + symbol_img.height + padding
    canvas = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.load_default()
    except Exception:  # pragma: no cover
        font = None

    y = padding
    for line in lines:
        draw.text((padding, y), line, fill='black', font=font)
        y += 22

    x = (width - symbol_img.width) // 2
    canvas.paste(symbol_img, (x, y + 8))

    out = io.BytesIO()
    canvas.save(out, format='PNG')
    return out.getvalue()


def label_image_base64(barcode: Barcode) -> str:
    png = render_label_png_bytes(barcode)
    return base64.b64encode(png).decode('ascii')


def render_label_pdf_bytes(barcode: Barcode) -> bytes:
    """Single-page PDF of the warehouse barcode label (A6)."""
    from reportlab.lib.pagesizes import A6
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as pdf_canvas

    png = render_label_png_bytes(barcode)
    page_w, page_h = A6
    buffer = io.BytesIO()
    c = pdf_canvas.Canvas(buffer, pagesize=A6)
    img = ImageReader(io.BytesIO(png))
    iw, ih = img.getSize()
    max_w = page_w - 24
    max_h = page_h - 24
    scale = min(max_w / float(iw), max_h / float(ih), 1.0)
    draw_w = iw * scale
    draw_h = ih * scale
    x = (page_w - draw_w) / 2
    y = (page_h - draw_h) / 2
    c.drawImage(img, x, y, width=draw_w, height=draw_h, preserveAspectRatio=True, mask='auto')
    c.showPage()
    c.save()
    return buffer.getvalue()


def label_image_content_file(barcode: Barcode) -> ContentFile:
    return ContentFile(render_label_png_bytes(barcode), name=f'{barcode.value}.png')
