# 一级装置研究重建实例验收报告

## 当前状态

本次实例已完成项目工作流、几何传递、COMSOL batch 几何 adapter gate 和 Geant4 1000 粒子受限电磁输运运行。物理验收未通过，研究链路在当前输入下停止。

## 已通过

- 当前四电极三腔 SolidWorks STEP 成功导入 COMSOL 6.4。
- COMSOL 成功保存当前 `.mph` 几何检查点。
- Geant4 11.2.2 transport executable 在 WSL 中编译并运行。
- 输入接口通过冻结 JSON/CSV 文件连接，没有使用进程间直接链接。
- 初始能量分布和本征方向分布按目标均值、标准差和 3σ 截断采样。

## 1000 粒子结果

- transport efficiency：0.519
- 95% Wilson 下置信界：0.488
- 引出径向动能 P90：6452.0 eV
- 引出轴向动能均值：62599.3 eV
- 目标：效率下置信界不低于 0.75、径向 P90 不高于 10 eV、轴向均值 1.00 keV ± 0.05 keV。

当前三项物理指标均未通过，因此没有增加到 10000 粒子，也没有创建结果 tag、Drive 归档或宣称研究结论。

## 模型边界

这是 `bounded_em_transport_surrogate`：包含 Geant4 电磁输运、磁场、几何损失和 stopping 接口；不包含原子俘获、muonic atom formation、核俘获或完整 μ− 生存模型。COMSOL 当前输出是几何 adapter gate，轴向电场为 0 V/m，尚未完成真实连续场求解。
