"use client";

import { Component, ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Error boundary — catches unhandled render errors and shows a fallback.
 * Use around any subtree that might throw (pool page, draft board, etc.).
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: { componentStack: string }) {
    // In production you'd send this to Sentry / similar
    console.error("[ErrorBoundary] Caught error:", error, info);
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "24px 20px",
            background: "rgba(189,54,47,0.04)",
            border: "1px solid rgba(189,54,47,0.15)",
            borderRadius: 16,
            margin: 16,
          }}
        >
          <p style={{ fontWeight: 800, color: "#7a2020" }}>Something went wrong</p>
          <p style={{ color: "#667487", fontSize: "0.9rem" }}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              alignSelf: "flex-start",
              padding: "8px 16px",
              border: "1px solid rgba(189,54,47,0.2)",
              borderRadius: 999,
              background: "white",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 700,
            }}
            type="button"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
