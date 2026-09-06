# 模型变化策略

代码通过 `git status` 和 `git diff` 检查。SolidWorks/COMSOL 二进制模型通过修改时间、大小、SHA256 和关键几何摘要检查。

首次正式运行发现任务相关模型相对登记版本变化时，必须暂停，列出旧版本、新版本和可能影响，并等待：

```text
adopt-new-model
或
keep-registered-model
```

运行期间的用户修改不污染当前快照。当前运行继续使用已固定的 `model-snapshot`，修改后的模型进入下一次运行。
