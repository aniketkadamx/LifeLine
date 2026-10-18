import * as React from "react";
import { User, Stethoscope, Pill } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/auth";

export type PublicRegistrationRole = Exclude<UserRole, "ADMIN">;

interface RoleOption {
  role: PublicRegistrationRole;
  title: string;
  badge: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Publicly registerable roles.
 * NOTE: ADMIN is intentionally excluded per security requirements (cannot be self-registered).
 */
const ROLE_OPTIONS: RoleOption[] = [
  {
    role: "PATIENT",
    title: "Patient / Individual",
    badge: "Personal Health",
    description:
      "Book doctor consultations, access video visits, store clinical records, and order medications.",
    icon: User,
  },
  {
    role: "DOCTOR",
    title: "Doctor / Clinician",
    badge: "Requires Verification",
    description:
      "Manage appointments, conduct live video consultations, issue digital prescriptions, and view patient history.",
    icon: Stethoscope,
  },
  {
    role: "PHARMACY",
    title: "Licensed Pharmacy",
    badge: "Requires Verification",
    description:
      "Dispense medications, review verified doctor prescriptions, and manage catalog inventory.",
    icon: Pill,
  },
];

export interface RoleSelectorProps {
  value?: PublicRegistrationRole;
  onChange: (role: PublicRegistrationRole) => void;
  disabled?: boolean;
  error?: string;
  className?: string;
}

export function RoleSelector({
  value,
  onChange,
  disabled = false,
  error,
  className,
}: RoleSelectorProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <fieldset
        role="radiogroup"
        aria-label="Account Role Selection"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "role-selector-error" : undefined}
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <legend className="sr-only">Choose your account role</legend>

        {ROLE_OPTIONS.map((option) => {
          const isSelected = value === option.role;
          const Icon = option.icon;

          return (
            <label
              key={option.role}
              data-testid={`role-option-${option.role.toLowerCase()}`}
              className={cn(
                "relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 text-left transition-all outline-none",
                "hover:border-primary/50 hover:bg-muted/30 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                isSelected
                  ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary"
                  : "border-border bg-card text-card-foreground",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              <input
                type="radio"
                name="role-selection"
                value={option.role}
                checked={isSelected}
                disabled={disabled}
                onChange={() => onChange(option.role)}
                className="sr-only"
                aria-label={option.title}
              />

              <div className="flex items-start justify-between gap-2 mb-2">
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="size-5" />
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase",
                    isSelected
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {option.badge}
                </span>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-foreground tracking-tight">
                  {option.title}
                </h4>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {option.description}
                </p>
              </div>
            </label>
          );
        })}
      </fieldset>

      {error && (
        <p id="role-selector-error" role="alert" className="text-xs text-destructive font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
