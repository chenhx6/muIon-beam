# Geant4 → COMSOL 一级 μ−–Ne 冷却 stopping 数据报告

> 文档性质：本项目的唯一信息入口和结果说明文件  
> 报告状态：第一版 feasibility baseline 已完成并通过接口验收  
> 报告日期：2026-09-03  
> 计算平台：WSL2 Ubuntu 20.04，Geant4 11.3.2  
> 任务边界：只完成 Geant4 → stopping-power 数据 → COMSOL 插值文件；没有修改 COMSOL

如果只阅读一个文件，请阅读本 README。阅读者不需要打开源码、CMake
文件或构建目录，也可以了解本次计算的目的、必要性、物理模型、全部
输出文件、图形含义、验证结果和后续 COMSOL 使用方法。

## 0. 一页结论

本项目用 Geant4 的电磁能损模型计算均匀纯 Neon 中 μ− 的平均 stopping
power，并将结果写成能量相关数据表。它用于替换 COMSOL 中人为设定的
constant friction coefficient，作为一级冷却模型的第一版输入。

建议 COMSOL 首先使用：

~~~text
comsol_muNe_SN.txt
~~~

这个文件只有两列：

~~~text
E_eV    SN_eV_m2
~~~

其中 SN 是按 Neon 原子数密度归一化后的 stopping cross section。COMSOL
中用实际 Neon number density 重新得到局部 stopping：

~~~text
S_local_eV_per_m = n_Ne_1_per_m3 * SN_muNe(Ktotal)
~~~

必须使用 μ− 的总 kinetic energy：

~~~text
Ktotal = Kperp + Kz
~~~

不能只用 Kperp 作为插值变量，因为 stopping 由粒子总速度决定。

本次基线使用：

~~~text
physics constructor: G4EmStandardPhysics_option3
particle:            mu-
material:            pure natural Neon
n_ref:               1.0e22 1/m^3
energy:              10 eV -> 1 MeV
points:              261
~~~

主要结果：

| μ− 动能 | dEdx_ref | SN | nu_ref | CSDA range |
|---:|---:|---:|---:|---:|
| 1 keV | 8.431107762959e2 eV/m | 8.431107762959e-20 eV·m² | 5.498465087254e5 s⁻¹ | 3.304141700494 m |
| 10 keV | 8.491389614494e3 eV/m | 8.491389614494e-19 eV·m² | 1.751311272542e6 s⁻¹ | 5.247632010055 m |
| 100 keV | 6.159198335543e3 eV/m | 6.159198335543e-19 eV·m² | 4.019629689464e5 s⁻¹ | 16.75118184044 m |

结论不是“μ− 受到一个常数摩擦力”。dEdx、SN 和 nu 都明显依赖能量，
因此采用插值表比 constant friction coefficient 更适合作为当前一级模型
的输入。

## 1. 本次任务回答什么问题

本次只回答一个问题：

> 在指定 Neon number density 下，Geant4 11.3.2 给出的 μ− 平均电磁能损
> 随 kinetic energy 如何变化？

当前结果是连续平均 slowing-down baseline，不是完整装置模拟，也不是
μ− 在 Neon 中的最终生存率或捕获率预测。

当前明确没有做以下内容：

- 真实一级装置几何；
- COMSOL 模型建立或修改；
- SolidWorks；
- μ− 注入窗；
- μ− 与 Ne 的 muonic atom formation；
- 原子俘获、俘获概率和后续原子级联；
- μ−–Ne 完整 elastic angular scattering；
- 复杂 detector simulation；
- 数百万条 Monte Carlo track 的平均。

因此，本结果的定位是：先获得一套可追溯、能量相关、密度可缩放的
Geant4 stopping input，用于后续 COMSOL 参数敏感性和模型可行性研究。

## 2. 为什么这个数据接口是必要的

### 2.1 不能继续把 friction coefficient 当成常数

如果在 COMSOL 中直接写成：

~~~text
F = -m_mu * nu_constant * v
~~~

那么一个常数需要同时代表低能区、模型切换区和较高能区的不同能损
行为。它无法表达 dEdx(E) 的能量变化，也无法自然地随 Neon number
density 缩放。

本项目改为先生成：

~~~text
SN(E) = dEdx_ref(E) / n_ref
~~~

然后在 COMSOL 中用实际 n_Ne 重建 stopping。这样 density 和 energy
dependence 被明确分开：

~~~text
energy dependence:  SN(E)
density dependence: n_Ne
~~~

### 2.2 为什么使用 G4EmCalculator

本项目优先使用 Geant4 官方提供的 G4EmCalculator，而不是用大量 track
样本反推平均能损，原因是：

1. 任务需要的是平均 dE/dx，不是单个事件的能损涨落；
2. G4EmCalculator 可以直接访问 Geant4 初始化后的能损模型；
3. ComputeTotalDEDX 可以在每个能量点直接计算总连续能损；
4. GetCSDARange 可以同时给出 CSDA range 诊断；
5. 结果更容易与 Geant4 版本、物理构造器和模型边界一起写入 metadata。

程序仍然调用了 BeamOn(0)，但这只是触发 Geant4 的 loss-table 和
CSDA-table 初始化。它处理零事件、零 track，不是 Monte Carlo stopping
平均。

### 2.3 为什么主值选 ComputeTotalDEDX

G4EmCalculator::ComputeTotalDEDX 是本项目主 stopping value。它按当前
Geant4 物理列表，把请求粒子和材料下所有 active energy-loss process
的贡献汇总起来。

本次还做了两个交叉检查：

- ComputeElectronicDEDX：检查电子能损部分；
- GetDEDX：检查 Geant4 已建好的 restricted dE/dx table。

在 1 keV 和 10 keV，三种计算基本一致；在 100 keV：

~~~text
ComputeTotalDEDX      = 6159.198335543 eV/m
ComputeElectronicDEDX = 6159.198335543 eV/m
GetDEDX               = 5269.224983227 eV/m
GetDEDX / total - 1   = -0.1444949982
~~~

这里 GetDEDX 是 restricted table，而主值是 on-the-fly 的 total dE/dx。
因此不能因为 restricted table 的数值不同就替换主值。本次选择
ComputeTotalDEDX，并把 GetDEDX 只作为诊断交叉检查。

## 3. 环境、源头依据和可追溯性

### 3.1 实际使用的本机环境

Geant4 版本在本机实际确认过：

~~~text
geant4-config --version
11.3.2

geant4-config --prefix
/opt/geant4/11.3.2
~~~

Geant4 数据集由以下环境脚本配置：

~~~text
/opt/geant4/11.3.2/bin/geant4.sh
~~~

本次 configure 使用的 CMake package：

~~~text
/opt/geant4/11.3.2/lib/cmake/Geant4
~~~

WSL 原生项目目录：

~~~text
/home/ys/work/muon_ne_g4
~~~

其中 source、build、build_debug、output、plots 和中间文件都位于 WSL
Linux 原生文件系统。没有在 /mnt/c、/mnt/d 或 /mnt/e 上进行 Geant4
configure、compile 或大量中间文件读写。

### 3.2 为什么可以相信低能模型名称

本次没有根据旧版本博客猜 API，而是读取并编译了本机 Geant4 11.3.2
实际头文件和源代码：

- G4EmCalculator.hh：确认 ComputeTotalDEDX、ComputeElectronicDEDX、
  GetDEDX、GetCSDARange 等接口；
- G4MuIonisation.cc：确认带负电粒子 q < 0 时，低能模型实际构造为
  G4ICRU73QOModel，高能模型为 G4MuBetheBlochModel；
- G4EmStandardPhysics_option3.cc：确认 option3 的本机最低 EM 能量为
  10 eV；
- G4EmBuilder::ConstructCharged：确认 μ− 注册了 muIoni。

程序初始化完成后又从运行时 muIoni process 读取模型名称和能量边界，
并写入 output/metadata.json。因此 README 中的模型说明同时有：

1. 本机 Geant4 11.3.2 源码依据；
2. 本次程序运行时的实际 metadata 依据。

### 3.3 为什么使用 G4VModularPhysicsList

本机 Geant4 11.3.2 的 G4RunManager 不接受裸的
G4EmStandardPhysics_option3/option4 作为 user initialization。程序按照
本机官方 TestEm 初始化方式，通过最小的 G4VModularPhysicsList 注册
EM physics constructor，然后再由 G4RunManager 初始化。

这是为了遵循 11.3.2 实际 API，不是额外添加了装置物理。

## 4. 粒子、Ne 材料和 number density

### 4.1 粒子

~~~text
particle name:  mu-
PDG encoding:   13
charge:         -1 eplus
mass:           1.8835315557426432e-28 kg
~~~

所有 stopping 查询都直接使用 mu- particle definition。没有把 μ− 换成
proton、electron 或 mu+。Geant4 内部可能复用基础表，但请求粒子和
最终输出粒子仍然是 mu-。

### 4.2 Ne 材料

材料是 100% natural Neon：

~~~text
element:       Ne
atomic number: 10
atomic mass:   20.18001128 g/mol
state:         gas
composition:   pure natural Neon
~~~

模型控制变量是 number density：

~~~text
n_ref = 1.0e22 1/m^3
~~~

Geant4 的 G4Material 构造必须接收 mass density，所以程序内部使用：

~~~text
rho = n_ref * A_Ne / N_A
~~~

本次参考材料内部使用的质量密度为：

~~~text
3.35096971064489e-4 kg/m^3
3.35096971064489e-7 g/cm^3
~~~

压力不是模型输入。metadata.json 中明确记录：

~~~text
pressure_input: null
~~~

程序实际读取：

~~~text
material->GetTotNbOfAtomsPerVolume()
~~~

得到的 Geant4 原子数密度为：

~~~text
actual G4 atom number density = 1.0e22 1/m^3
relative error                = 0
~~~

这一步是必要的，因为 COMSOL 后续使用的是 number density，不应该把
pressure 偷换成模型主输入。

## 5. 实际 physics model

### 5.1 option3 基线

本次正式基线是：

~~~text
G4EmStandardPhysics_option3
~~~

运行时 muIoni 模型列表为：

| 运行时名称 | Geant4 源码类 | 实际能量范围 |
|---|---|---:|
| ICRU73QO | G4ICRU73QOModel | 10 eV – 200 keV |
| MuBetheBloch | G4MuBetheBlochModel | 200 keV – 1e14 eV |

本次运行时 probe 结果：

| probe energy | 实际 muIoni model |
|---:|---|
| 10 eV | ICRU73QO |
| 100 eV | ICRU73QO |
| 199999 eV | ICRU73QO |
| 200000 eV | ICRU73QO |
| 200001 eV | MuBetheBloch |
| 1 MeV | MuBetheBloch |

因此，μ− 在 200 keV 以下的实际低能 model 是 ICRU73QO，对应本机源码
类 G4ICRU73QOModel。恰好 200 keV 时本次 Geant4 运行时仍选择低能模型；
刚高于 200 keV 才切换到 MuBetheBloch。

### 5.2 option4 补充比较

程序还运行了：

~~~text
G4EmStandardPhysics_option4
~~~

option4 在本机的最低 EM 能量是 100 eV，所以补充表从 100 eV 开始，
共 209 点。它的 muIoni 模型名称仍然是 ICRU73QO 和 MuBetheBloch。

option3 和 option4 的共同能量点共 209 个，得到：

~~~text
SN_opt4 / SN_opt3 = 1.0
~~~

本次不平均 option3 和 option4。option3 保持明确的正式 baseline；
option4 只用于显示本机两个 EM constructor 在 muon stopping 上的比较。

## 6. 能量网格和输出列

### 6.1 基线能量网格

option3 主表包含 261 个严格递增点：

- 251 个从 10 eV 到 1 MeV 的 logarithmic points；
- 加入显式锚点并去重、排序。

显式锚点包括：

~~~text
10, 20, 50, 100, 200, 500 eV
1, 2, 5, 10, 20, 50 keV
100, 200, 500 keV, 1 MeV
~~~

这样可以覆盖低能 exploratory 区，也可以覆盖 COMSOL 以后可能重新
加速 μ− 的更高能区。

### 6.2 主 CSV

正式主表：

~~~text
mu_minus_Ne_stopping_master.csv
~~~

列顺序和单位：

| 列名 | 含义 | 单位 |
|---|---|---|
| E_eV | μ− total kinetic energy | eV |
| v_m_s | 相对论速度 | m/s |
| dEdx_ref_eV_per_m | 正号 stopping power，等于 −dE/dx | eV/m |
| SN_eV_m2 | dEdx_ref / n_ref | eV·m² |
| nu_ref_s-1 | dEdx_ref / (m_mu·v) | s⁻¹ |
| CSDA_range_ref_m | Geant4 CSDA range 诊断值 | m |

CSV 使用科学计数法，数值列不包含单位字符串，编码为 ASCII-compatible
文本。

### 6.3 三个 COMSOL 两列表

| 文件 | 两列 | 用途 |
|---|---|---|
| comsol_muNe_SN.txt | E_eV, SN_eV_m2 | 推荐的 route A |
| comsol_muNe_nu_ref.txt | E_eV, nu_ref_s-1 | route B friction 形式 |
| comsol_muNe_SN_SI.txt | E_J, SN_J_m2 | COMSOL 使用 joule 自变量时 |

这三个 TXT 文件都没有复杂 header，实际内容是两列空白分隔数值。

### 6.4 验证和比较文件

| 文件 | 用途 |
|---|---|
| density_scaling_validation.csv | 1e21、1e22、1e23 1/m³ 的线性缩放检查 |
| opt3_vs_opt4.csv | 共同能量点的 SN_opt4/SN_opt3 |
| metadata.json | option3 基线的版本、材料、模型、单位和验证元数据 |
| metadata_opt4.json | option4 补充运行的元数据 |

## 7. COMSOL 后续如何使用

### 7.1 推荐 route A：SN 插值

导入：

~~~text
comsol_muNe_SN.txt
~~~

建议建立插值函数：

~~~text
SN_muNe(E)
~~~

自变量使用 E_eV，因变量使用 SN_eV_m2。COMSOL 中实际 Neon number
density 用变量 n_Ne_1_per_m3 表示：

~~~text
S_local_eV_per_m = n_Ne_1_per_m3 * SN_muNe(Ktotal)
Ktotal          = Kperp + Kz
~~~

如果 COMSOL 的 force 变量使用 SI 牛顿，则能量单位要从 eV 转成 J：

~~~text
u        = v_vec / max(|v_vec|, v_floor)
F_stop_N = -(S_local_eV_per_m * 1.602176634e-19) * u
~~~

v_floor 只用于避免 |v| 接近 0 时除零。它不代表新的物理过程。

### 7.2 可选 route B：等效 nu 插值

导入：

~~~text
comsol_muNe_nu_ref.txt
~~~

使用：

~~~text
nu(E,n_Ne) = nu_ref(E) * n_Ne / n_ref
F_stop     = -m_mu * nu(E,n_Ne) * v_vec
~~~

这里 nu_ref 只是 SN 数据的等效表示，不是额外添加的碰撞机制。

在连续 slowing approximation 下，route A 和 route B 应满足：

~~~text
m_mu * nu_ref(E) * |v|
= dEdx_ref(E) * 1.602176634e-19
~~~

### 7.3 COMSOL 插值变量的关键限制

必须使用 total kinetic energy：

~~~text
Ktotal = Kperp + Kz
~~~

不能使用 Kperp 单独插值。只用 Kperp 会把轴向动能从 stopping 速度中
遗漏，导致 stopping force 与真实总速度不一致。

本任务到接口文件生成和验证为止，不继续建立或修改 COMSOL 模型。

## 8. 结果表和物理读法

### 8.1 代表性能量点

以下均为 option3、n_ref = 1e22 1/m³ 的结果：

| E | 量 | 数值 |
|---:|---|---:|
| 1 keV | dEdx_ref | 8.431107762959e2 eV/m |
| 1 keV | SN | 8.431107762959e-20 eV·m² |
| 1 keV | nu_ref | 5.498465087254e5 s⁻¹ |
| 1 keV | CSDA range | 3.304141700494 m |
| 10 keV | dEdx_ref | 8.491389614494e3 eV/m |
| 10 keV | SN | 8.491389614494e-19 eV·m² |
| 10 keV | nu_ref | 1.751311272542e6 s⁻¹ |
| 10 keV | CSDA range | 5.247632010055 m |
| 100 keV | dEdx_ref | 6.159198335543e3 eV/m |
| 100 keV | SN | 6.159198335543e-19 eV·m² |
| 100 keV | nu_ref | 4.019629689464e5 s⁻¹ |
| 100 keV | CSDA range | 16.75118184044 m |

### 8.2 对这些数值的正确理解

- dEdx_ref 是在 n_ref 下每米损失的正值；
- SN 去掉了 number-density 因子，是后续 COMSOL 最重要的接口量；
- nu_ref 是把同一个 stopping 写成 F = −m·nu·v 的等效速率；
- CSDA range 是诊断量，不等于完整 μ− 生存距离；
- 低能区的曲线变化说明 stopping 不能用一个常数 friction coefficient
  代表。

## 9. 验证结果

本次已实际完成：

| 验收项 | 结果 |
|---|---|
| CMake configure | 成功 |
| compile | 成功 |
| Geant4 version | 11.3.2 |
| particle | mu− |
| material | pure natural Neon |
| reference n | 1e22 1/m³ |
| actual G4 n | 1e22 1/m³ |
| 主表能区 | 10 eV – 1 MeV |
| 主表点数 | 261 |
| 数值 finite | 通过 |
| stopping power > 0 | 通过 |
| energy strictly increasing | 通过 |
| NaN/Inf | 未发现 |
| COMSOL 两列表 | 三个文件均成功生成 |
| density scaling | 通过 |

密度缩放使用：

~~~text
1e21, 1e22, 1e23 1/m^3
E = 1 keV, 10 keV, 100 keV
~~~

最大误差：

~~~text
actual number-density relative error: 0
dEdx linearity relative error:         4.44e-16
SN relative error:                     2.22e-16
~~~

因此在本次验证范围内：

~~~text
dEdx ∝ n_Ne
SN   = dEdx / n_Ne 基本保持不变
~~~

## 10. 图形怎么读

图形位于 WSL 原生项目的 plots 目录。它们只用于快速人工检查，正式
接口仍以 CSV/TXT 为准。横轴优先采用 logarithmic scale，跨数量级的
纵轴也采用 logarithmic scale。

| 图文件 | 图形回答的问题 | 读图重点 |
|---|---|---|
| dEdx_vs_E.png | 每米平均能损怎样随能量变化 | 能损显著依赖 E，不是常数 |
| SN_vs_E.png | 去掉 Neon density 后的 stopping 形状怎样 | 后续 COMSOL route A 的核心曲线 |
| nu_vs_E.png | 如果写成 friction 形式，等效 nu 怎样变化 | nu 也不是常数，且要与总速度配套 |
| range_vs_E.png | CSDA range 怎样随 E 增长 | 只作 slowing-down 诊断，不是 capture/survival |
| opt3_vs_opt4.png | option4 与 option3 的 stopping 比值 | 共同区间基本为 1.0，不做平均 |

图形的科学用途是检查：

1. 能量点是否连续、单调；
2. 曲线是否跨越合理的数量级；
3. 低能模型到高能模型切换附近是否出现需要关注的结构；
4. option3 和 option4 是否发生明显差异；
5. dEdx、SN、nu 三种表示之间是否具有一致的趋势。

图形不是 COMSOL 的正式数据接口，也不应从图片读取数值。

## 11. 当前最重要的物理限制

以下标记必须随低能结果一起保留：

~~~text
LOW ENERGY — EXPLORATORY / MODEL UNCERTAINTY
~~~

特别是：

- 10 eV–1 keV 只作为 feasibility 和参数敏感性研究输入；
- 几十 eV 区域不能解释为已验证的 μ−–Ne 真实碰撞预测；
- 当前结果不包含 μ−–Ne elastic angular scattering；
- 不包含 low-energy atomic capture；
- 不包含 muonic atom formation；
- 不包含 atomic capture probability；
- 不包含 Auger 或完整原子级联；
- 不包含注入窗、装置几何和 detector。

因此，当前表可以回答“如果只用 Geant4 EM mean stopping baseline，
COMSOL 中 stopping input 的数量级和能量依赖如何”，但不能回答：

- μ− 最终有多大概率被 Ne 捕获；
- μ− 能否形成 muonic Ne；
- 低于 1 keV 后的真实 angular distribution；
- 真实装置中的 beam survival probability。

这些问题属于后续物理扩展，不应在当前 README 中把本表解释过度。

## 12. 文件清单

### 12.1 正式接口文件

~~~text
mu_minus_Ne_stopping_master.csv
comsol_muNe_SN.txt
comsol_muNe_nu_ref.txt
comsol_muNe_SN_SI.txt
density_scaling_validation.csv
metadata.json
mu_minus_Ne_stopping_opt4.csv
opt3_vs_opt4.csv
metadata_opt4.json
~~~

Windows 端只需要保留和查看这些 CSV/TXT/JSON 数据文件。当前工作区中
它们位于 muon\ne\g4 数据目录；如果项目文件夹被再次移动，文件名和
README 中的相对关系不变。

### 12.2 WSL 原生计算项目

~~~text
/home/ys/work/muon_ne_g4/README.md
/home/ys/work/muon_ne_g4/output/
/home/ys/work/muon_ne_g4/plots/
/home/ys/work/muon_ne_g4/src/
/home/ys/work/muon_ne_g4/build/
~~~

其中：

- output 是数据接口和日志；
- plots 是快速检查图；
- src 是 Geant4 程序；
- build 是 WSL 原生构建目录；
- README 是本报告；
- metadata 是版本和模型证据。

对日常使用而言，只需要先看本 README，再按第 7 节导入推荐 TXT。

## 13. 如何重新生成

后续重新计算时仍然必须在 WSL 原生路径执行：

~~~bash
source /opt/geant4/11.3.2/bin/geant4.sh
cd ~/work/muon_ne_g4

geant4-config --version
geant4-config --prefix
geant4-config --datasets

cmake -S . -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DGeant4_DIR=/opt/geant4/11.3.2/lib/cmake/Geant4
cmake --build build --parallel 2

./build/bin/mu_ne_stopping option3 output
./build/bin/mu_ne_stopping option4 output
python3 plot_stopping.py output plots
~~~

重新生成完成后，至少检查：

1. metadata.json 的 Geant4 version；
2. particle 是否仍为 mu−；
3. muIoni 的低能模型和边界；
4. actual G4 atom number density；
5. 主表能量范围和点数；
6. density_scaling_validation.csv 是否通过；
7. TXT 是否仍是两列、无单位字符串；
8. 是否出现 NaN、Inf 或非正 stopping。

## 14. Geant4 升级后的规则

升级 Geant4 后不要静默覆盖旧结果。应当：

1. 先运行新的 geant4-config --version、--prefix、--datasets；
2. 使用新的 WSL 原生 build 目录，例如 build_11_4；
3. 重新 configure 和 compile；
4. 重新运行 option3、option4 和所有验证；
5. 检查低能 model 名称及能量边界是否变化；
6. 将新版本写入新的 metadata；
7. 明确决定是否替换 COMSOL 正式接口文件。

不同 Geant4 版本的表不能只凭文件名混合使用。COMSOL 接口文件必须
和对应的 metadata 一起归档。

## 15. 最终建议

当前阶段建议：

1. 把 option3 作为唯一正式 baseline；
2. COMSOL 优先导入 comsol_muNe_SN.txt；
3. 插值自变量使用 Ktotal，而不是 Kperp；
4. number density 在 COMSOL 中作为独立控制变量；
5. v → 0 附近使用 v_floor；
6. nu 文件只作为等效 friction 形式或交叉检查；
7. 不平均 option3 和 option4；
8. 对低于 1 keV 的结果始终保留 exploratory/model-uncertainty 标记；
9. 本阶段不继续添加 COMSOL 几何、捕获或 detector 物理。

本报告到 Geant4 → COMSOL 数据接口生成、验证和解释为止。
