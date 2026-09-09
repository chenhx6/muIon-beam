# 07_research_system

统一研究控制层与执行模块。

```text
07_research_system/
├─ control/
│  ├─ contracts/        # 跨模块合同与冻结实例
│  ├─ research-state/   # 唯一当前科研状态源
│  └─ research-workflow/# 目标、路由、诊断与收尾
└─ blocks/
   ├─ 3d/               # SolidWorks 几何 Block
   ├─ comsol/            # COMSOL 计算 Block
   └─ geant4/            # Geant4 输运 Block
```

`00_project/` 继续负责治理、Manifest、Schema、任务卡、索引和归档。模型、运行、结果和报告仍分别位于 `02_models/`、`03_runs/`、`04_results/` 和 `05_reports/`。所有模块的路径解析集中在 `paths.mjs`；旧根目录入口已退役。
