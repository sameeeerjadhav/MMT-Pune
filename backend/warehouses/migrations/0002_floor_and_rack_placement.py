import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('warehouses', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Floor',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=50)),
                ('name', models.CharField(max_length=150)),
                ('level', models.IntegerField(default=1, help_text='Floor level number (1 = ground)')),
                (
                    'row_count',
                    models.PositiveIntegerField(default=4, help_text='Number of rack rows on this floor'),
                ),
                (
                    'column_count',
                    models.PositiveIntegerField(
                        default=5, help_text='Number of rack columns on this floor'
                    ),
                ),
                ('description', models.CharField(blank=True, max_length=255)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                (
                    'warehouse',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='floors',
                        to='warehouses.warehouse',
                    ),
                ),
            ],
            options={
                'ordering': ['warehouse_id', 'level', 'code'],
                'unique_together': {('warehouse', 'code')},
            },
        ),
        migrations.AddField(
            model_name='rack',
            name='column_index',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='rack',
            name='row_index',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='rack',
            name='floor',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='racks',
                to='warehouses.floor',
            ),
        ),
        migrations.AddConstraint(
            model_name='rack',
            constraint=models.UniqueConstraint(
                condition=models.Q(('floor__isnull', False), ('row_index__isnull', False), ('column_index__isnull', False)),
                fields=('floor', 'row_index', 'column_index'),
                name='uniq_floor_rack_cell',
            ),
        ),
    ]
