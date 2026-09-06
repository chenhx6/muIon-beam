# Variable catalog schema

`00_project/traceability/variable-catalog.yaml` 是唯一事实源。它自动生成：

```text
00_project/traceability/VARIABLE_CATALOG.md
00_project/traceability/VARIABLE_CATALOG.csv
```

每个变量至少包含：

```yaml
canonical_name:
display_name_zh:
definition_zh:
allowed_alias: []
unit:
dimension:
data_type:
value_type:
default_value:
allowed_range:
physical_region:
model_layer:
input_or_output:
derived_from: []
used_by_tasks: []
introduced_in:
deprecated_in:
change_reason:
reference_ids: []
```

变量规范名称使用完整、可读的英文名称。专业缩写只能作为已登记 alias 使用。
