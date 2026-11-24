"""Raw label-printer command generation (ZPL for Zebra-style, TSPL for TSC-style printers).

The phone (or a print agent) sends these commands over TCP (usually port 9100) to a printer
on the warehouse Wi-Fi. Nothing here talks to a printer directly.

Layout is intentionally simple and proportional to the label size so the same code works for
the 50 x 25 mm and 100 x 50 mm presets. Verify on the real printer before relying on it.
"""

from __future__ import annotations

from barcodes.models import Printer

ALLOWED_DPI = (203, 300)
MIN_LABEL_MM = 10
MAX_LABEL_MM = 200


def mm_to_dots(mm: float, dpi: int) -> int:
    return max(1, round(mm * dpi / 25.4))


def label_lines_from_data(label_data: dict | None) -> list[str]:
    """Human-readable lines printed above the barcode, skipping empty fields."""
    data = label_data or {}
    candidates = [
        data.get('item_name'),
        f"Code: {data.get('item_code')}" if data.get('item_code') else '',
        f"Batch/Unit: {data.get('batch_or_unit')}" if data.get('batch_or_unit') else '',
        f"GRN: {data.get('grn_number')}" if data.get('grn_number') else '',
        f"Qty: {data.get('quantity')}" if data.get('quantity') not in (None, '') else '',
    ]
    return [str(line) for line in candidates if line]


def _code128_module_count(value: str) -> int:
    # Code 128: (characters + start + check + stop-ish) * 11 modules, plus termination bar.
    return (len(value) + 3) * 11 + 13


def _zpl_safe(text: str) -> str:
    # ^ and ~ are ZPL command prefixes; newlines would break the field.
    return text.replace('^', ' ').replace('~', ' ').replace('\r', ' ').replace('\n', ' ')


def _tspl_safe(text: str) -> str:
    # TSPL text is quoted; keep it ASCII so the printer's built-in fonts render it.
    ascii_text = text.encode('ascii', 'replace').decode('ascii')
    return ascii_text.replace('"', "'").replace('\r', ' ').replace('\n', ' ')


def build_zpl(*, value: str, lines: list[str], width_mm: float, height_mm: float, dpi: int) -> str:
    width = mm_to_dots(width_mm, dpi)
    height = mm_to_dots(height_mm, dpi)
    margin = max(6, round(width * 0.03))
    text_h = max(18, round(height * 0.11))
    line_h = text_h + 4
    char_w = max(8, round(text_h * 0.55))

    max_text_lines = max(1, int((height * 0.55 - margin) // line_h))
    max_chars = max(8, int((width - 2 * margin) // char_w))

    commands = ['^XA', '^CI28', f'^PW{width}', f'^LL{height}', '^LH0,0']

    y = margin
    for line in lines[:max_text_lines]:
        text = _zpl_safe(line)[:max_chars]
        commands.append(f'^FO{margin},{y}^A0N,{text_h},{text_h}^FD{text}^FS')
        y += line_h

    bc_top = y + 4
    human_h = max(14, round(text_h * 0.8))
    bc_height = max(20, height - margin - bc_top - human_h)
    module = max(1, min(4, (width - 2 * margin) // _code128_module_count(value)))
    commands.append(f'^FO{margin},{bc_top}^BY{module},3,{bc_height}')
    commands.append(f'^BCN,{bc_height},Y,N,N^FD{_zpl_safe(value)}^FS')

    commands.extend(['^PQ1', '^XZ'])
    return '\n'.join(commands) + '\n'


def build_tspl(*, value: str, lines: list[str], width_mm: float, height_mm: float, dpi: int) -> str:
    width = mm_to_dots(width_mm, dpi)
    height = mm_to_dots(height_mm, dpi)
    mult = 2 if dpi >= 300 else 1
    margin = max(6, round(width * 0.03))
    line_h = 22 * mult
    char_w = 12 * mult

    max_text_lines = max(1, int((height * 0.55 - margin) // line_h))
    max_chars = max(8, int((width - 2 * margin) // char_w))

    commands = [
        f'SIZE {width_mm:g} mm,{height_mm:g} mm',
        'GAP 2 mm,0 mm',
        'DIRECTION 1',
        'CLS',
    ]

    y = margin
    for line in lines[:max_text_lines]:
        text = _tspl_safe(line)[:max_chars]
        commands.append(f'TEXT {margin},{y},"2",0,{mult},{mult},"{text}"')
        y += line_h

    bc_top = y + 4
    human_h = 18 * mult
    bc_height = max(20, height - margin - bc_top - human_h)
    narrow = max(1, min(4, (width - 2 * margin) // _code128_module_count(value)))
    commands.append(
        f'BARCODE {margin},{bc_top},"128",{bc_height},1,0,{narrow},{narrow * 3},"{_tspl_safe(value)}"'
    )

    commands.append('PRINT 1,1')
    return '\r\n'.join(commands) + '\r\n'


def build_label_commands(
    *,
    language: str,
    value: str,
    lines: list[str],
    width_mm: float,
    height_mm: float,
    dpi: int,
) -> str:
    if dpi not in ALLOWED_DPI:
        raise ValueError(f'dpi must be one of {ALLOWED_DPI}')
    if language == Printer.Language.TSPL:
        return build_tspl(value=value, lines=lines, width_mm=width_mm, height_mm=height_mm, dpi=dpi)
    return build_zpl(value=value, lines=lines, width_mm=width_mm, height_mm=height_mm, dpi=dpi)


def render_barcode_label_commands(barcode, printer: Printer) -> str:
    """Printer-ready commands for a warehouse Code 128 label (batch / unit)."""
    return build_label_commands(
        language=printer.language,
        value=barcode.value,
        lines=label_lines_from_data(barcode.label_data),
        width_mm=printer.label_width_mm,
        height_mm=printer.label_height_mm,
        dpi=printer.dpi,
    )


def render_test_label_commands(printer: Printer) -> str:
    return build_label_commands(
        language=printer.language,
        value='TEST-PRINT',
        lines=[
            'MMT Pune printer test',
            f'Printer: {printer.name}',
            f'{printer.host}:{printer.port}',
        ],
        width_mm=printer.label_width_mm,
        height_mm=printer.label_height_mm,
        dpi=printer.dpi,
    )
