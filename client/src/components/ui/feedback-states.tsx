import * as React from "react";
import { AlertCircle, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  text?: string;
}

export function LoadingSpinner({
  size = "md",
  text,
  className,
  ...props
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center justify-center gap-2 text-muted-foreground", className)}
      {...props}
    >
      <Loader2 className={cn("animate-spin text-primary", sizeClasses[size])} />
      {text && <span className="text-sm font-medium">{text}</span>}
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function PageLoader({ text = "Loading LifeLine Healthcare..." }: { text?: string }) {
  return (
    <div
      className="flex min-h-[60vh] w-full flex-col items-center justify-center space-y-4 p-8 text-center"
      data-testid="page-loader"
    >
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
}

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title = "No data available",
  description = "There are no records matching your request at this time.",
  icon: Icon = FolderOpen,
  actionLabel,
  onAction,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-8 text-center",
        className
      )}
      data-testid="empty-state"
      {...props}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <div className="mt-5">
          <Button variant="outline" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export interface ErrorAlertProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorAlert({
  title = "An unexpected error occurred",
  message = "Please try again or contact LifeLine support if the issue persists.",
  onRetry,
  className,
  ...props
}: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-destructive",
        className
      )}
      data-testid="error-alert"
      {...props}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="size-5 shrink-0 translate-y-0.5 text-destructive" />
        <div className="flex-1">
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="mt-1 text-sm text-destructive/90">{message}</p>
          {onRetry && (
            <div className="mt-3">
              <Button
                variant="destructive"
                size="xs"
                onClick={onRetry}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Try Again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
