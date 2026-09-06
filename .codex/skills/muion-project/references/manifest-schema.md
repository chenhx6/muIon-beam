# Manifest schema

正式运行 Manifest 至少包含：

```yaml
manifest_id:
manifest_type: run
schema_version:
created_at:
updated_at:
parent_manifest_id:
task_id:
run_id:
status:
maturity_level:
retention_level:
physical_regions: []
input_references: []
model_references: []
variable_catalog_ref:
software_versions: {}
git: {}
drive: {}
reports: {}
files: []
human_summary_zh:
unknowns: []
limitations: []
```

正式运行完成后 Manifest 不得静默覆盖。修正必须创建新版本并设置 `parent_manifest_id`。

文件记录至少包含：`path`、`role`、`size`、`sha256`、`retention_level`、`upload_policy`、`local_status`、`drive_status` 和 `gitee_status`。
