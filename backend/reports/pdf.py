from io import BytesIO

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _styles():
    styles = getSampleStyleSheet()
    return styles


def build_withdrawals_report_pdf(withdrawals) -> bytes:
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm)
    styles = _styles()
    story = [
        Paragraph('Warehouse Inventory — Withdrawal Report', styles['Title']),
        Paragraph(f'Generated {timezone.now().strftime("%Y-%m-%d %H:%M UTC")}', styles['Normal']),
        Spacer(1, 8 * mm),
    ]

    header = ['ID', 'When', 'Purpose', 'User', 'Lines']
    rows = [header]
    for w in withdrawals:
        line_bits = []
        for line in w.lines.all():
            code = line.batch.batch_code if line.batch_id else (line.unit.unit_code if line.unit_id else '—')
            item = ''
            if line.batch_id and line.batch.item_id:
                item = line.batch.item.name
            elif line.unit_id and line.unit.item_id:
                item = line.unit.item.name
            flag = ' OVERRIDE' if line.fifo_override else ''
            line_bits.append(f'{code} · {item} · qty {line.quantity}{flag}')
        user_label = w.user.get_full_name() or w.user.username
        rows.append(
            [
                str(w.id),
                timezone.localtime(w.created_at).strftime('%Y-%m-%d %H:%M'),
                w.purpose,
                user_label,
                '\n'.join(line_bits) or '—',
            ]
        )

    table = Table(rows, colWidths=[18 * mm, 32 * mm, 28 * mm, 35 * mm, 70 * mm])
    table.setStyle(
        TableStyle(
            [
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0B1F33')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 8),
                ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#D5DEE8')),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F7F9FC')]),
                ('LEFTPADDING', (0, 0), (-1, -1), 4),
                ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(table)
    doc.build(story)
    return buffer.getvalue()


def build_withdrawal_receipt_pdf(withdrawal) -> bytes:
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    styles = _styles()
    user = withdrawal.user
    role = getattr(getattr(user, 'role', None), 'code', '') or ''
    story = [
        Paragraph(f'Withdrawal Receipt #{withdrawal.id}', styles['Title']),
        Paragraph('Airport Equipment Manufacturing — Warehouse', styles['Normal']),
        Spacer(1, 6 * mm),
        Paragraph(f'<b>Purpose:</b> {withdrawal.purpose}', styles['Normal']),
        Paragraph(f'<b>Reference:</b> {withdrawal.reference or "—"}', styles['Normal']),
        Paragraph(f'<b>Notes:</b> {withdrawal.notes or "—"}', styles['Normal']),
        Paragraph(
            f'<b>Performed by:</b> {user.get_full_name() or user.username} '
            f'(@{user.username}'
            + (f', {role}' if role else '')
            + (f', emp {user.employee_id}' if getattr(user, 'employee_id', None) else '')
            + ')',
            styles['Normal'],
        ),
        Paragraph(
            f'<b>Date/time:</b> {timezone.localtime(withdrawal.created_at).strftime("%Y-%m-%d %H:%M:%S %Z")}',
            styles['Normal'],
        ),
        Spacer(1, 8 * mm),
        Paragraph('<b>Lines</b>', styles['Heading2']),
    ]

    rows = [['Code', 'Item', 'Qty', 'Location', 'FIFO']]
    for line in withdrawal.lines.select_related('batch__item', 'unit__item').all():
        code = line.batch.batch_code if line.batch_id else (line.unit.unit_code if line.unit_id else '—')
        item = '—'
        if line.batch_id and line.batch.item_id:
            item = f'{line.batch.item.item_code} — {line.batch.item.name}'
        elif line.unit_id and line.unit.item_id:
            item = f'{line.unit.item.item_code} — {line.unit.item.name}'
        loc = line.previous_location or {}
        loc_str = (
            f"{loc.get('warehouse', '')}/{loc.get('rack', '')}/{loc.get('shelf', '')}/{loc.get('position', '')}"
            if loc
            else '—'
        )
        fifo = 'OVERRIDE' if line.fifo_override else 'OK'
        rows.append([code, item, str(line.quantity), loc_str, fifo])

    table = Table(rows, colWidths=[30 * mm, 55 * mm, 20 * mm, 40 * mm, 25 * mm])
    table.setStyle(
        TableStyle(
            [
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0C6E6A')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#D5DEE8')),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F7F9FC')]),
            ]
        )
    )
    story.append(table)
    doc.build(story)
    return buffer.getvalue()
