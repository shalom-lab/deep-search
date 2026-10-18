/** 渲染错误兜底：任何组件抛错时给出可操作的提示，而不是白屏。 */
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 保留完整堆栈，方便在控制台或反馈里定位
    console.error('[ErrorBoundary] 渲染出错：', error, info?.componentStack);
  }

  handleReload = () => {
    // 开发期最常见的原因是 HMR 残留（模块被热替换后上下文实例不一致），刷新即可恢复
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isDev = Boolean(import.meta.env?.DEV);
    const isProviderError = /AppProvider|Provider|useContext|必须在/.test(`${error.name} ${error.message}`);

    return React.createElement(
      'div',
      { className: 'app-fatal' },
      React.createElement(
        'div',
        { className: 'app-fatal-card' },
        React.createElement('h1', null, '应用渲染出错'),
        React.createElement(
          'p',
          null,
          isProviderError
            ? '状态上下文没能正确挂载。开发期这通常是热更新残留导致的——刷新页面即可恢复。'
            : '页面在渲染时抛出了异常。可以先尝试刷新；如果反复出现，请把下面的信息反馈给我们。',
        ),
        React.createElement('pre', { className: 'app-fatal-msg' }, `${error.name}: ${error.message}`),
        React.createElement(
          'div',
          { className: 'app-fatal-actions' },
          React.createElement('button', { type: 'button', className: 'btn primary', onClick: this.handleReload }, '刷新页面'),
          React.createElement('button', { type: 'button', className: 'btn ghost', onClick: this.handleReset }, '重试渲染'),
        ),
        isDev && error.stack
          ? React.createElement('details', { className: 'app-fatal-stack' }, React.createElement('summary', null, '开发环境堆栈'), React.createElement('pre', null, error.stack))
          : null,
      ),
    );
  }
}
