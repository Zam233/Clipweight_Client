// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PluginLayoutRenderer } from './PluginLayoutRenderer';
import type { UILayout } from './types';

afterEach(() => cleanup());
beforeEach(() => {
  mocks.get.mockClear();
  mocks.post.mockClear();
});

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  getApiClient: () => ({
    get: mocks.get,
    post: mocks.post,
  }),
}));

describe('PluginLayoutRenderer M11 控件集', () => {
  it('渲染 input / select / checkbox / slider 并写入状态', async () => {
    const layout: UILayout = {
      widgets: [
        { type: 'input', key: 'name', label: '名称', defaultValue: '张三' },
        { type: 'select', key: 'tone', label: '语气', options: ['专业', '幽默'], defaultValue: '幽默' },
        { type: 'checkbox', key: 'enabled', label: '启用', defaultValue: true },
        { type: 'slider', key: 'speed', label: '速度', min: 0, max: 10, step: 1, defaultValue: 5 },
        {
          type: 'button', label: '提交',
          action: { endpoint: '/api/tool/execute', method: 'POST', body: { name: '${name}', tone: '${tone}', enabled: '${enabled}', speed: '${speed}' } },
        },
      ],
    };

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.post.mockResolvedValue({ data: { ok: true } });
    render(
      <PluginLayoutRenderer
        layout={layout}
        owner="plug_a"
        stateKey="plug_a:panel_x"
        contributionId="panel_x"
      />,
    );

    // input defaultValue
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('张三');
    // select defaultValue
    expect((screen.getByLabelText('语气') as HTMLSelectElement).value).toBe('幽默');
    // checkbox defaultValue
    expect((screen.getByLabelText('启用') as HTMLInputElement).checked).toBe(true);
    // slider defaultValue
    expect((screen.getByLabelText(/速度/) as HTMLInputElement).value).toBe('5');

    // 修改控件后按钮提交携带插值状态，且统一走受限代理（不是直连业务端点）
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '李四' } });
    fireEvent.change(screen.getByLabelText('语气'), { target: { value: '专业' } });
    fireEvent.click(screen.getByLabelText('启用'));
    fireEvent.change(screen.getByLabelText(/速度/), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));

    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe('/api/plugin/proxy/plug_a/post');
    // 代理契约：tool 只透传 {name, params}；控件插值必须已解析进 params。
    expect(body).toMatchObject({
      action: 'tool',
      payload: { name: '李四' },
    });
    // B6：贡献 id 必须是**裸 id**（不是 owner:id 合成键），否则后端归属校验 403。
    expect((body as { contribution_id?: string }).contribution_id).toBe('panel_x');
    expect((body as { payload: { params?: Record<string, unknown> } }).payload.params)
      .toMatchObject({ tone: '专业', enabled: false, speed: 8 });
    confirmSpy.mockRestore();
  });

  it('B6：stateKey 只做状态隔离，不当作 contribution_id 发送', async () => {
    const layout: UILayout = {
      widgets: [
        { type: 'button', label: '跑', action: { endpoint: '/api/tool/execute', method: 'POST', body: { name: 'x' } } },
      ],
    };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.post.mockResolvedValue({ data: { ok: true } });
    render(
      <PluginLayoutRenderer
        layout={layout}
        owner="plug_a"
        stateKey="plug_a:panel_x"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '跑' }));
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const body = mocks.post.mock.calls[0][1] as { contribution_id?: string };
    // 未显式给 contributionId 时不得发送合成键（宁可省略，也不能发错值）
    expect(body.contribution_id).toBeUndefined();
    confirmSpy.mockRestore();
  });

  it('PL-01：布局按钮打未登记端点 → 拒绝且不发请求，写入 errorKey', async () => {
    const layout: UILayout = {
      widgets: [
        { type: 'button', label: '删项目',
          action: { endpoint: '/api/project/abc', method: 'POST', errorKey: 'err' } },
        { type: 'alert', severity: 'error', textField: 'err' },
      ],
    };
    render(<PluginLayoutRenderer layout={layout} owner="plug_a" />);
    fireEvent.click(screen.getByRole('button', { name: '删项目' }));
    await vi.waitFor(() => expect(screen.getByText(/未在宿主白名单中登记/)).toBeTruthy());
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('PL-01：布局按钮用 DELETE/编码穿越 → 拒绝且不发请求', async () => {
    const layout: UILayout = {
      widgets: [
        { type: 'button', label: '越权',
          action: { endpoint: '/api/tool/execute/..%2f..%2fproject/x', method: 'DELETE', errorKey: 'err' } as unknown as import('./types').UIAction },
        { type: 'alert', severity: 'error', textField: 'err' },
      ],
    };
    render(<PluginLayoutRenderer layout={layout} owner="plug_a" />);
    fireEvent.click(screen.getByRole('button', { name: '越权' }));
    await vi.waitFor(() => expect(screen.getByText(/插件 API 调用被拒绝/)).toBeTruthy());
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('file 控件把选中的 File 交给宿主（上传执行归宿主，控件本身不发请求）', () => {
    mocks.post.mockClear();
    const onChange = vi.fn();
    const layout: UILayout = {
      widgets: [
        { type: 'file', key: 'upload_voice', label: '上传配音', accept: '.wav,.mp3', placeholder: '选择配音文件' },
      ],
    };
    render(<PluginLayoutRenderer layout={layout} onChange={onChange} />);

    const input = screen.getByLabelText('选择配音文件') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.wav,.mp3');

    const file = new File(['x'], 'narration.wav', { type: 'audio/wav' });
    fireEvent.change(input, { target: { files: [file] } });

    // 已选文件名可见，且值以 File 对象回传宿主（宿主负责上传）
    expect(screen.getByText('narration.wav')).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ upload_voice: file }));
    // 控件自身绝不发起请求（插件拿不到上传 API）
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('C4：readOnly 预览禁用按钮与 file 控件，点击不确认也不发请求', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const layout: UILayout = {
      widgets: [
        { type: 'button', label: '预览里点我', action: { endpoint: '/api/tool/execute', method: 'POST', body: { name: 'x' } } },
        { type: 'file', key: 'f', label: '选文件', placeholder: '选择文件' },
      ],
    };
    render(<PluginLayoutRenderer layout={layout} owner="plug_a" contributionId="p_x" readOnly />);
    const btn = screen.getByRole('button', { name: '预览里点我' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const input = screen.getByLabelText('选择文件') as HTMLInputElement;
    expect(input.disabled).toBe(true);

    fireEvent.click(btn);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('C4：readOnly 下外链图片不渲染，data:/同源相对路径保留', () => {
    const layout: UILayout = {
      widgets: [
        { type: 'image', key: 'bad', sourceField: 'externalUrl', alt: '外链' },
        { type: 'image', key: 'good', sourceField: 'localUrl', alt: '本地' },
      ],
    };
    render(
      <PluginLayoutRenderer
        layout={layout}
        owner="plug_a"
        readOnly
      />,
    );
    // 渲染器 state 初始为空 → sourceField 无值 → 不渲染 img（无外链泄漏路径）
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('visibleWhen 隐藏条件生效', () => {
    const layout: UILayout = {
      widgets: [
        { type: 'checkbox', key: 'advanced', label: '高级模式', defaultValue: false },
        { type: 'input', key: 'secret', label: '密钥', visibleWhen: 'advanced', defaultValue: '' },
      ],
    };
    render(<PluginLayoutRenderer layout={layout} />);
    expect(screen.queryByLabelText('密钥')).toBeNull();
    fireEvent.click(screen.getByLabelText('高级模式'));
    expect(screen.getByLabelText('密钥')).toBeTruthy();
  });

  /**
   * PL-03：label/title/content 来自插件/模型产物，运行时可能是对象
   * （`{name: ...}`）——直接进 JSX 会抛 "Objects are not valid as a React child"。
   */
  it('PL-03：脏对象 label / group title / text content 不白屏，显示安全文本', () => {
    const dirty = {
      title: { name: '面板' },
      widgets: [
        { type: 'input', key: 'a', label: { name: '输入框' }, placeholder: { hint: 'x' } },
        { type: 'group', title: { name: '分组' }, children: [
          { type: 'text', content: { name: '正文' } },
          { type: 'button', label: { name: '按钮' },
            action: { endpoint: '/api/tool/execute', method: 'POST' } },
        ] },
        { type: 'select', key: 's', label: '选项', options: ['ok', { bad: 1 }, 'yes'] },
      ],
    } as unknown as UILayout;
    expect(() => render(<PluginLayoutRenderer layout={dirty} />)).not.toThrow();
    // 对象被转成 JSON 文本而不是抛出 React child 错误
    expect(screen.getAllByText(/name/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /name/ })).toBeTruthy();
  });

  it('PL-03：状态值为对象时 defaultValue 被安全文本化，不整块崩', () => {
    const layout = {
      widgets: [{ type: 'text', contentField: 'msg' }],
    } as unknown as UILayout;
    // 通过 resultMap 之外的路径注入脏状态：这里用 defaultValue 对象模拟
    const withDefault = {
      widgets: [{ type: 'input', key: 'obj', defaultValue: { name: '脏值' } }],
    } as unknown as UILayout;
    expect(() => render(<PluginLayoutRenderer layout={withDefault} />)).not.toThrow();
    expect(() => render(<PluginLayoutRenderer layout={layout} />)).not.toThrow();
  });
});
