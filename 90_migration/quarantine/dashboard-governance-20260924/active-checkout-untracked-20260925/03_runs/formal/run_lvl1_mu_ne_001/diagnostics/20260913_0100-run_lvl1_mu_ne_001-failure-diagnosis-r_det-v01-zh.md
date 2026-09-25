# 一级装置能量输运失败诊断

## 证据

上一轮 1000 粒子运行的结果为：输运效率 0.519，Wilson 下置信界 0.488，径向动能 P90 6452 eV，轴向动能均值 62.6 keV。

## 已确认原因

1. COMSOL 文件是几何导入和 `.mph` 检查点 gate，`physics_solve` 为 `not_evaluated`。
2. Geant4 field snapshot 的轴向电场为 `0 V/m`，没有提供把 100 keV 降到 1 keV 的连续电势设计。
3. Geant4 transport 程序读取 stopping 表路径并记录哈希接口，但没有把 stopping 表作为逐步能损函数显式应用；能量损失只由 Geant4 材料过程产生。
4. 当前 Geant4 场实现使用磁场追踪接口，电场参数只记录在结果中，尚未参与积分。

## 结论

当前结果是失败诊断证据，不能通过增加事件数变成正式验收。必须先生成真实 COMSOL 电场快照，改造 Geant4 的电磁场积分和 stopping 接口，再重新进行候选密度筛选。
