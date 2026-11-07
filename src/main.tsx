import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

type Props = { children: ReactNode };
type State = { hasError: boolean };

class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(): State { return { hasError: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo): void {}
  render(): ReactNode { return this.state.hasError ? <div className="app-error"><strong>Nearfund could not load.</strong><span>Refresh the preview to try again.</span><button onClick={() => window.location.reload()}>Refresh preview</button></div> : this.props.children; }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
);
