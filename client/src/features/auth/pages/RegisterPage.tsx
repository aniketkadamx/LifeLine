import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  ShieldAlert,
  User,
  Loader2,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { RoleSelector, type PublicRegistrationRole } from "../components/RoleSelector";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorAlert } from "@/components/ui/feedback-states";
import type { UserRole } from "@/types/auth";

/**
 * Client-side validation schema matching server/src/validators/auth.validator.ts.
 */
export const registerFormSchema = z
  .object({
    role: z.enum(["PATIENT", "DOCTOR", "PHARMACY"], {
      required_error: "Please select an account role",
    }),
    fullName: z
      .string()
      .min(2, "Full name must be at least 2 characters long")
      .max(100, "Full name cannot exceed 100 characters")
      .transform((val) => val.trim()),
    email: z
      .string()
      .min(1, "Email is required")
      .email("Please enter a valid email address")
      .transform((val) => val.toLowerCase().trim()),
    phone: z
      .string()
      .min(1, "Phone number is required")
      .regex(
        /^\+?[1-9]\d{1,14}$/,
        "Phone number must be in E.164 format (e.g. +15551234567 or +919876543210)"
      )
      .transform((val) => val.trim()),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters long")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
        "Password must contain an uppercase letter, lowercase letter, digit, and special symbol (@$!%*?&)"
      ),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterFormValues = z.infer<typeof registerFormSchema>;

interface RegisterApiResponse {
  success: boolean;
  data: {
    userId: string;
    email: string;
    role: UserRole;
    status: string;
  };
  message: string;
}

const TOTAL_STEPS = 4;

export function RegisterPage() {
  const [currentStep, setCurrentStep] = React.useState(1);
  const [showPassword, setShowPassword] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [registrationResult, setRegistrationResult] = React.useState<RegisterApiResponse["data"] | null>(null);

  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    control,
    trigger,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      role: "PATIENT",
      fullName: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
    },
    mode: "onTouched",
  });

  const selectedRole = watch("role");
  const formValues = watch();

  const handleNextStep = async () => {
    setApiError(null);
    let isValid = false;

    if (currentStep === 1) {
      isValid = await trigger("role");
    } else if (currentStep === 2) {
      isValid = await trigger(["fullName", "email", "phone"]);
    } else if (currentStep === 3) {
      isValid = await trigger(["password", "confirmPassword"]);
    }

    if (isValid && currentStep < TOTAL_STEPS) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrevStep = () => {
    setApiError(null);
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const onSubmit = async (values: RegisterFormValues) => {
    setApiError(null);

    try {
      // NOTE: confirmPassword is strictly excluded; backend contract only accepts email, password, role, fullName, phone
      const payload = {
        email: values.email,
        password: values.password,
        role: values.role,
        fullName: values.fullName,
        phone: values.phone,
      };

      const res = await api.post<RegisterApiResponse>("/auth/register", payload);
      setRegistrationResult(res.data);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          if (err.code === "AUTH_EMAIL_ALREADY_EXISTS") {
            setApiError("This email address is already registered. Please sign in or use a different email.");
          } else if (err.code === "AUTH_PHONE_ALREADY_EXISTS") {
            setApiError("This phone number is already registered. Please check the number or sign in.");
          } else {
            setApiError(err.message || "An account with these details already exists.");
          }
        } else if (err.status === 422) {
          setApiError(err.message || "Please check your entered details for validation errors.");
        } else {
          setApiError(err.message || "Registration failed. Please try again.");
        }
      } else {
        setApiError("Network connection error. Please try again.");
      }
    }
  };

  // =========================================================================
  // SUCCESS / CONFIRMED REGISTRATION STATE
  // =========================================================================
  if (registrationResult) {
    const isHealthcareProvider =
      registrationResult.role === "DOCTOR" || registrationResult.role === "PHARMACY";

    return (
      <Card className="shadow-lg border-border">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 mb-2">
            <CheckCircle2 className="size-7" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Registration Successful
          </CardTitle>
          <CardDescription>
            Your LifeLine account has been created.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Account Role</span>
              <Badge variant={registrationResult.role.toLowerCase() as "patient" | "doctor" | "pharmacy"}>
                {registrationResult.role}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Account Status</span>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                <Clock className="size-3.5" />
                {registrationResult.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Registered Email</span>
              <span className="font-medium text-foreground">{registrationResult.email}</span>
            </div>
          </div>

          <div className="rounded-lg bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-3.5 text-xs text-blue-900 dark:text-blue-200 space-y-1.5">
            <p className="font-semibold flex items-center gap-1.5">
              <ShieldAlert className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
              Next Steps & Verification
            </p>
            <p>
              Please check your email inbox to verify your address.
              {isHealthcareProvider && (
                <>
                  {" "}As a {registrationResult.role.toLowerCase()}, your account remains in{" "}
                  <strong>PENDING_VERIFICATION</strong> status until clinical credentials and medical licenses are reviewed by platform administrators.
                </>
              )}
            </p>
          </div>
        </CardContent>

        <CardFooter>
          <Button
            className="w-full"
            onClick={() => navigate("/login")}
            data-testid="registration-proceed-login"
          >
            Proceed to Sign In
            <ArrowRight className="size-4 ml-2" />
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // =========================================================================
  // MULTI-STEP REGISTRATION WIZARD
  // =========================================================================
  return (
    <Card className="shadow-lg border-border">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
          Create LifeLine Account
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground mt-1">
          Step {currentStep} of {TOTAL_STEPS}:{" "}
          {currentStep === 1 && "Select Account Type"}
          {currentStep === 2 && "Personal Details"}
          {currentStep === 3 && "Account Security"}
          {currentStep === 4 && "Review & Confirmation"}
        </CardDescription>

        {/* Accessible Progress Indicator */}
        <div
          className="grid grid-cols-4 gap-1.5 pt-3"
          role="progressbar"
          aria-valuenow={currentStep}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-label={`Registration progress step ${currentStep} of ${TOTAL_STEPS}`}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, index) => {
            const stepNum = index + 1;
            const isCompleted = stepNum < currentStep;
            const isCurrent = stepNum === currentStep;

            return (
              <div
                key={stepNum}
                className={`h-1.5 rounded-full transition-colors ${
                  isCompleted || isCurrent ? "bg-primary" : "bg-muted"
                }`}
              />
            );
          })}
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4 pt-4">
          {apiError && (
            <ErrorAlert
              title="Registration Failed"
              message={apiError}
              data-testid="register-api-error"
            />
          )}

          {/* STEP 1: ROLE SELECTION */}
          {currentStep === 1 && (
            <div className="space-y-3" data-testid="register-step-1">
              <Label className="text-sm font-semibold">Choose your account role</Label>
              <Controller
                name="role"
                control={control}
                render={({ field }) => (
                  <RoleSelector
                    value={field.value as PublicRegistrationRole}
                    onChange={(val) => field.onChange(val)}
                    error={errors.role?.message}
                  />
                )}
              />
            </div>
          )}

          {/* STEP 2: PERSONAL & CONTACT INFORMATION */}
          {currentStep === 2 && (
            <div className="space-y-3.5" data-testid="register-step-2">
              <div className="space-y-1.5">
                <Label htmlFor="reg-fullname">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reg-fullname"
                    type="text"
                    autoComplete="name"
                    placeholder={
                      selectedRole === "DOCTOR"
                        ? "Dr. Gregory House"
                        : selectedRole === "PHARMACY"
                        ? "LifeLine Medico Pharmacy"
                        : "Alice Jenkins"
                    }
                    className="pl-9"
                    aria-invalid={Boolean(errors.fullName)}
                    aria-describedby={errors.fullName ? "reg-fullname-error" : undefined}
                    {...register("fullName")}
                  />
                </div>
                {errors.fullName && (
                  <p id="reg-fullname-error" role="alert" className="text-xs text-destructive font-medium">
                    {errors.fullName.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    className="pl-9"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "reg-email-error" : undefined}
                    {...register("email")}
                  />
                </div>
                {errors.email && (
                  <p id="reg-email-error" role="alert" className="text-xs text-destructive font-medium">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-phone">Phone Number (E.164 Format)</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reg-phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+15551234567 or +919876543210"
                    className="pl-9"
                    aria-invalid={Boolean(errors.phone)}
                    aria-describedby={errors.phone ? "reg-phone-error" : undefined}
                    {...register("phone")}
                  />
                </div>
                {errors.phone ? (
                  <p id="reg-phone-error" role="alert" className="text-xs text-destructive font-medium">
                    {errors.phone.message}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Include country code prefix (e.g. +1 for US, +91 for India).
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: ACCOUNT SECURITY & PASSWORD */}
          {currentStep === 3 && (
            <div className="space-y-3.5" data-testid="register-step-3">
              <div className="space-y-1.5">
                <Label htmlFor="reg-password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reg-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="pl-9 pr-10"
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? "reg-password-error" : undefined}
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground focus:outline-none"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p id="reg-password-error" role="alert" className="text-xs text-destructive font-medium">
                    {errors.password.message}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground leading-normal">
                  Minimum 8 characters with at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-confirm-password">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reg-confirm-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="pl-9"
                    aria-invalid={Boolean(errors.confirmPassword)}
                    aria-describedby={errors.confirmPassword ? "reg-confirm-password-error" : undefined}
                    {...register("confirmPassword")}
                  />
                </div>
                {errors.confirmPassword && (
                  <p id="reg-confirm-password-error" role="alert" className="text-xs text-destructive font-medium">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: REVIEW & CONFIRMATION */}
          {currentStep === 4 && (
            <div className="space-y-3.5" data-testid="register-step-4">
              <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">Account Role</span>
                  <Badge variant={formValues.role?.toLowerCase() as "patient" | "doctor" | "pharmacy"}>
                    {formValues.role}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Full Name:</span>
                  <span className="font-medium text-foreground">{formValues.fullName}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Email:</span>
                  <span className="font-medium text-foreground">{formValues.email}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Phone:</span>
                  <span className="font-medium text-foreground">{formValues.phone}</span>
                </div>
              </div>

              <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground">Terms & Privacy Acknowledgement</p>
                <p>
                  By creating an account, you agree to LifeLine's Healthcare Terms of Service and HIPAA Privacy Practices.
                </p>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col space-y-3 pt-2">
          <div className="flex items-center justify-between w-full gap-3">
            {currentStep > 1 && (
              <Button
                type="button"
                variant="outline"
                onClick={handlePrevStep}
                disabled={isSubmitting}
                className="w-1/3"
                data-testid="register-back-button"
              >
                <ArrowLeft className="size-4 mr-1.5" />
                Back
              </Button>
            )}

            {currentStep < TOTAL_STEPS ? (
              <Button
                type="button"
                onClick={handleNextStep}
                className={currentStep === 1 ? "w-full" : "w-2/3"}
                data-testid="register-continue-button"
              >
                Continue
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-2/3"
                data-testid="register-submit-button"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Registering...
                  </>
                ) : (
                  <>
                    Complete Registration
                    <CheckCircle2 className="size-4 ml-1.5" />
                  </>
                )}
              </Button>
            )}
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-semibold text-primary hover:underline underline-offset-4"
            >
              Sign In
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
