# VARIABLE_CATALOG

来源：`00_project/traceability/variable-catalog.yaml`（自动生成，不手工编辑）

| 规范名称 | 中文名称 | 定义 | 单位 | 类型 | 区域 | 模型层 | 别名 |
|---|---|---|---|---|---|---|---|
| neon_number_density | 氖气数密度 | 单位体积内的氖原子数 | 1/m^3 | input | R02-slowing-capture<br>R03-charge-state-conversion<br>R04-fast-extraction | Geant4|COMSOL | Ne_density |
| coil_diameter | 螺线管直径 | 一级装置螺线管直径 | mm | input | R01-device-geometry | 3D|COMSOL |  |
| target_magnetic_field | 目标磁场 | 螺线管轴向目标磁场 | T | input | R01-device-geometry<br>R02-slowing-capture | 3D|COMSOL |  |
| neon_temperature | 氖气温度 | Ne 工作气体温度 | K | input | R02-slowing-capture | Geant4|COMSOL |  |
| electrode_aperture_diameter | 电极孔径 | 环形电极中心孔直径 | mm | input | R01-device-geometry<br>R03-charge-state-conversion | 3D|COMSOL |  |
| mu_minus_initial_kinetic_energy_mean | 初始负mu子动能均值 | 截断前初始负mu子动能分布均值 | keV | input | R02-slowing-capture | Geant4 |  |
| mu_minus_initial_kinetic_energy_sigma | 初始负mu子动能标准差 | 初始负mu子动能分布标准差 | keV | input | R02-slowing-capture | Geant4 |  |
| mu_minus_intrinsic_radial_direction_mean | 本征径向动量方向均值 | muon本征坐标系中的径向动量方向均值 | degree | input | R02-slowing-capture | Geant4|COMSOL |  |
| mu_minus_intrinsic_radial_direction_sigma | 本征径向动量方向标准差 | muon本征坐标系中的径向动量方向标准差 | degree | input | R02-slowing-capture | Geant4|COMSOL |  |
| transport_efficiency | 输运效率 | 到达引出平面的粒子数与截断后实际注入粒子数之比 | dimensionless | output | R04-fast-extraction | Geant4|COMSOL |  |
| radial_kinetic_energy_at_extraction | 引出径向动能 | 粒子到达引出平面时的径向动能 | eV | output | R04-fast-extraction | Geant4|COMSOL |  |
| axial_kinetic_energy_at_extraction | 引出轴向动能 | 粒子到达引出平面时的轴向动能 | keV | output | R04-fast-extraction | Geant4|COMSOL |  |

## 字段说明

规范名称用于代码、参数文件和 Manifest；中文名称用于报告和图表；别名必须登记后才能使用。
