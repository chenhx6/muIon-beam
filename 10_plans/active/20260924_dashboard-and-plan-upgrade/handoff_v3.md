# 新 session 执行提示词

在 muIon-beam 项目执行已批准的 plan_v3。模型使用我在界面选择的 gpt-6-luna，推理 max；不要自行切换模型。

先读取以下绝对路径中的完整计划和机器checkpoint：
D:/muIon-beam/_work/current/worktrees/codex-d80b7f12073a98b4eb63-2/10_plans/active/20260924_dashboard-and-plan-upgrade/plan_v3.md
D:/muIon-beam/_work/current/worktrees/codex-d80b7f12073a98b4eb63-2/10_plans/active/20260924_dashboard-and-plan-upgrade/plan_v3.json

读取当前 AGENTS.md、active-adr.json 和相关项目skill，执行项目启动契约。使用返回的合法worktree；上面路径是只读交接来源，将计划采用到自己的工作树并维护checkpoint。先核对main、origin/main、历史worker -1与规划worker -2，不照抄旧plan_v02的completed结论。

目标：修复dashboard匿名历史中断卡、计划步骤/下一步/子agent展示、实时数据git隔离；补齐d80遗漏成果；每个可交付节点自动集成main、测试、push Gitee、验证必要Drive归档和t标签；任务结束自动释放claim并回收已交付worktree/branch。

标签边界固定：t=计划节点交付；b=明确单独发布的基础设施版本；r=正式结果。旧r0/r1等保留，不重命名/移动/删除，不补任何历史tag，只给本次plan_v3实际验收上传的节点打tag。不执行科研任务，不生成科研结果tag。

先P0，再建立P3/P4最小交付链，之后P1/P2和P5。遵循ponytail，复用现有组件；用户已授权计划内实施和节点发布，无需再次等我说完成后push。需要子agent只派明确独立任务，不能创建一串leader线程解决同一阻塞。

用离线checkpoint和真实证据持续执行。禁止覆盖未登记用户修改、强推、用reset/clean/ours/theirs掩盖冲突、绕过宿主边界或改信任数据库。tag必须指向已验证main交付SHA且重试幂等。以main实际代码、远端clone、Drive内容读回和浏览器状态迁移验收，不能仅凭main干净/测试绿色/页面可访问宣布完成。出错保留具体现场和修复经验；不重复轮询同一阻塞。

请为本次执行开启一个goal，目标为完整完成上述plan_v3，按节点更新离线计划。只有所有明确需求均有证据、必要交付和回收完成后才将plan/goal标为complete。结束时简述提交、远端tag、Drive、dashboard和分支/worktree处理结果及证据路径。
