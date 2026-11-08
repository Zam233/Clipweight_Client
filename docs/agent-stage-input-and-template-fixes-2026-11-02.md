# 阶段 edit 起不来 / 二次派发卡死 / 「深色底板＋原文引述」（2026-11-02）

用户报三个问题，全部用**实机事件流与 sidecar 证据**定位，没有靠猜。

---

## 一、阶段 edit 无法开始：`缺输入 script_skeleton、candidate_clips`

### 证据（`task_55db71fe3a` 的真实事件流）

| seq | 事件 | 内容 |
|---|---|---|
| 11 / 13 / 17 | `tool_call` → `tool_result` | `read_artifact(path="art_f2237630.json")`、`list_dir(path=".")` → **全部 error：路径安全校验失败: 路径不在允许的目录内** |
| 21 | `delegate_agent stage=edit` | 黑板空 → `阶段 edit 缺输入：script_skeleton、candidate_clips` |
| 36 | `structure → ok` | 分镜 43 个（产物落在 `artifacts/art_f2237630.json`） |
| 385 | `material → ok` | 候选素材落在 `artifacts/art_XXXX.json` |
| 391 | `edit → failed` | `ValidationError: candidate_clips Input should be a valid list, input_value={'artifact': 'art_eb6c6398', 'path': 'artifacts/art_eb6c6398.json'}` |

三个独立缺陷串成一条死路：

1. **工具不认工作区相对路径**。`ToolRegistry.execute` 拿模型给的 `path` 直接
   `assert_allowed_path`，相对路径按服务器 CWD 解析 → 一律拒绝。
   后果：主 agent 摸黑，只能凭猜派阶段 → 第一次 edit 必然缺输入。
2. **阶段输入不解析 artifact 引用**。系统提示明确要求大对象用
   `{"artifact": …, "path": …}` 传，但 `EditInput.candidate_clips: list` 收到 dict
   直接抛 Pydantic `ValidationError` → edit 永远起不来。
3. **续跑任务黑板是空的**。中止后再说一句 → 新任务 → 黑板空 → 又是"缺输入"。

### 修法

| 位置 | 改动 |
|---|---|
| `tool/registry.py` | 通用路径校验只对**绝对路径**生效；相对路径交给工具按工作区解析后再校验（工具内已有各自的 `assert_allowed_path`） |
| `tool/fs_tools.py` | `read_file` / `list_dir` / `write_file` 增加 `workspace_root` / `project_id` 形参（`surface.execute` 会自动注入），`_guarded()` 支持 `base` 并把相对路径拼到工作区根 |
| `tool/artifacts.py` | `read_artifact(path=…)` 相对路径按工作区根解析；只给 `artifact` id 时也能在工作区里找到 `artifacts/<id>.json` |
| `services/stage_inputs.py` | 新增 `resolve_refs()`：装配前把 `{"artifact"/"path"}` 引用**解析成真实内容**（只读工作区，解析失败原样保留交给缺键校验） |
| `services/stage_subagent.py` | `_missing_failure` 改成**每个缺失键一条 needs**（旧实现把 `script_skeleton、candidate_clips` 拼成一个字符串，主 agent 无法逐项补齐） |
| `services/agent_kernel.py` | 新增 `seed_blackboard(src, dst)`：续跑任务继承上一轮黑板（内存优先，其次 sidecar；幂等，只补缺键） |
| `services/requirements_service.py` | `_continue_as_task` 建任务后调用 `seed_blackboard`，并发一条 `context_loaded` 事件说明继承了哪些键 |
| `services/agent_loop.py` | 系统提示补三条硬规则：阶段顺序（animation 必须在 audio 之前，否则黑板守卫拒绝写回）、easing 白名单、"工作区文件用相对路径就行，一次失败不等于没产物" |

### 验证（真实数据，非模拟）

- `list_dir(".")` → **ok，9 项**；`list_dir("artifacts")` → **ok，8 项**；
  `read_artifact("artifacts/art_f2237630.json")` → **ok，31228 字节**（旧实现全部报路径校验失败）。
- 从 `task_55db71fe3a` 的 sidecar 继承 9 个黑板键（`script_skeleton / scenes /
  candidate_clips / edit_notes / timeline / animation_plan / generated_mg_count /
  audio_notes / final_timeline`），`stage_inputs.assemble("edit", …)` →
  **`EditInput` 构造成功，43 场景 / 43 候选**（旧实现：缺输入）。
- 同一装配把 `candidate_clips` 传成引用
  `{"artifact": "art_eb6c6398", "path": "artifacts/art_eb6c6398.json"}` →
  **解析成 list(43)**（旧实现：`ValidationError: Input should be a valid list`）。
- `seed_blackboard` 幂等：第二次调用返回 0。

---

## 二、二次派发时浏览器卡死 / 闪退

### 证据

- 前端没有崩溃上报记录（`logs/client-errors.jsonl` 只有我自己的探针）；
  tab 级 OOM 崩溃不会留下 JS 异常——所以只能从"哪里在烧"入手。
- 一个任务的 400 条上限事件里，**约 300 条是 `thinking` 增量**（`task_55db71fe3a`
  的 seq 4/9/15/19/28…394 全是 thinking）。每条 `applyEvent` 都整表复制 + 全表重渲染
  （`EventFeed` 400 行、`TaskToolTrace` 分组合并几百次调用、`TraceInspector` 序列化 JSON）。
  二次派发会让事件密度再上一个台阶，这正是"卡死→被回收"的典型路径。

### 修法

`src/stores/taskStore.ts`：`applyEvent` 对**同一 `round` 的连续 `thinking` 增量就地合并**
（`delta` 保留尾部 8000 字），只在合并后 set 一次。
等价信息不丢，事件条数降一个量级，`lastSeq` 仍推进到最新。

> 未做：真正的列表虚拟化。本轮先消除"碎片事件"，因为那是量级问题；虚拟化留待有
> 真实复现时再动（不拿没证据的性能改造赌稳定性）。

---

## 三、material 失败 → 「深色底板＋原文引述文字」

### 证据（`reports/progress.md` + 事件流）

```
降级：text_llm_failed · 校验失败：elements[0].keyframes[0]: invalid easing
'ease-out-back', must be one of ['back-out', 'bounce', 'ease', …]
降级：text_llm_fallback_template · 文字动画 LLM 生成失败，回退 AnimationCatalog 模板（anim_id=typewriter）
```

- "深色底板＋原文引述文字"就是 **`typewriter` 模板**渲染出来的文字卡；
- 它被触发的原因是**一个近义词**：模型写了 `ease-out-back`（CSS/GSAP 常用写法），
  `VALID_EASINGS` 不含它 → 校验失败 → 整段文字动画回退模板；
- 叠加的第二个原因是顺序错误：`blackboard_merge_failed · animation 不能覆盖 audio
  写的时间线`（主 agent 在 audio 之后重派 animation，白烧 337s 且产物写不回黑板）。
- material 本身在报告里是 `ok`（`03-material-1.md`）；"素材靠不住 → 用排版卡"是
  **主 agent 自己的策略**（brief 里写着 `material_policy: no_network_no_download`、
  `visual_style: 深色底 + 一句核心句`），它来自上一轮的失败记忆——这也解释了为什么
  修好路径/黑板后仍要盯住模型别把"没素材"当成默认假设。

### 修法

| 位置 | 改动 |
|---|---|
| `animation/mg/validator.py` | 新增 `EASING_ALIASES` + `normalize_easing()`：`ease-out-back / easeOutBack / spring / bounceOut / ease_in_out …` → 规范名；校验把**已知别名**视为合法，`repair_mg_json` 顺手归一化并记账；真正非法的值仍然报错 |
| `services/agent_loop.py` | 系统提示明确 easing 白名单，并说明"校验失败会让整段文字动画回退成模板（用户看到的就是深色底板＋原文引述）" |

### 验证

```text
ease-out-back -> 'back-out'      easeOutBack -> 'back-out'
spring        -> 'elastic-out'   bounceOut   -> 'bounce'
easeInOut     -> 'ease-in-out'   ease_in_out -> 'ease-in-out'
校验（别名）: True
修复: ["elements[0]: easing 'ease-out-back' → 'back-out'",
       "elements[0]: easing 'spring' → 'elastic-out'"]
非法取值 'wattt' 仍判非法 ✔
```

---

## 遗留 / 后续观察

1. **顺序守卫 vs 主 agent 的自觉**：黑板只允许 edit→animation→audio 单向覆盖，这条要
   靠提示词约束模型；如果仍频繁出现"audio 之后重派 animation"，下一步应把
   `delegate_agent` 的阶段顺序做成硬校验（拒绝并回传"当前 timeline 由 audio 写入，
   请先重派 audio"）。
2. **material 的"无网络"策略**：`material_policy=no_network_no_download` 是模型自己加的
   约束，会让成片退化成排版卡。若确认要走联网素材，应在任务 extra 里显式给出素材源，
   并让 `material_agent` 在"零候选"时明确报 `material_placeholder` 而不是静默降级。
3. 二次派发的卡死只做了"碎片合并"这一步；如果仍复现，下一步需要把 `TaskToolTrace` /
   `EventFeed` 改虚拟滚动，并把 `TraceInspector` 的 `JSON.stringify` 提到 `useMemo`。
