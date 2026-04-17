import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router";

import { RouteErrorPage } from "./RouteErrorPage";

interface ErrorBoundaryProps {
  fallback: (error: Error) => ReactNode;
  resetKey?: unknown;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

export const RouteErrorBoundary: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const location = useLocation();
  return (
    <ErrorBoundary
      resetKey={location.pathname}
      fallback={(error) => <RouteErrorPage error={error} />}
    >
      {children}
    </ErrorBoundary>
  );
};
