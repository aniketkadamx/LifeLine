import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail, ArrowRight, Loader2 } from "lucide-react";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { getRoleDashboardPath, isSafeRedirectPath } from "@/routes/ProtectedRoute";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/feedback-states";
import type { AuthUser } from "@/types/auth";

export const loginFormSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .transform((val) => val.toLowerCase().trim()),
  password: z.string().min(1, "Password is required"),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

interface LoginApiResponse {
  success: boolean;
  data: {
    accessToken: string;
    user: AuthUser;
  };
  message: string;
}

export function LoginPage() {
  const [showPassword, setShowPassword] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);

  const { login } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
    mode: "onTouched",
  });

  const onSubmit = async (values: LoginFormValues) => {
    setApiError(null);

    try {
      const response = await api.post<LoginApiResponse>("/auth/login", {
        email: values.email,
        password: values.password,
      });

      const { accessToken, user } = response.data;

      // Update in-memory auth store (Zero persistent storage of access tokens)
      login(user, accessToken);

      // Resolve safe post-login destination
      const rawFrom = (location.state as { from?: { pathname?: string } })?.from?.pathname;
      const targetDestination = isSafeRedirectPath(rawFrom)
        ? rawFrom
        : getRoleDashboardPath(user.role);

      navigate(targetDestination, { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setApiError("Invalid email or password. Please verify your credentials.");
        } else if (err.status === 403) {
          setApiError(err.message || "Your account has been suspended. Please contact support.");
        } else if (err.status === 429) {
          setApiError("Too many login attempts. Please wait 15 minutes before trying again.");
        } else {
          setApiError(err.message || "Unable to complete login. Please try again later.");
        }
      } else {
        setApiError("A network error occurred. Please check your internet connection.");
      }
    }
  };

  return (
    <Card className="shadow-lg border-border">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
          Sign In to LifeLine
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground mt-1">
          Enter your registered email and password to access your healthcare portal
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {apiError && (
            <ErrorAlert
              title="Authentication Failed"
              message={apiError}
              data-testid="login-api-error"
            />
          )}

          {/* Email Field */}
          <div className="space-y-1.5">
            <Label htmlFor="login-email">Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                className="pl-9"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "login-email-error" : undefined}
                {...register("email")}
              />
            </div>
            {errors.email && (
              <p id="login-email-error" role="alert" className="text-xs text-destructive font-medium">
                {errors.email.message}
              </p>
            )}
          </div>

          {/* Password Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password">Password</Label>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                className="pl-9 pr-10"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "login-password-error" : undefined}
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground focus:outline-none"
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={0}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {errors.password && (
              <p id="login-password-error" role="alert" className="text-xs text-destructive font-medium">
                {errors.password.message}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-3 pt-2">
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
            data-testid="login-submit-button"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                Sign In
                <ArrowRight className="size-4 ml-2" />
              </>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Don't have an account?{" "}
            <Link
              to="/register"
              className="font-semibold text-primary hover:underline underline-offset-4"
            >
              Create an account
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
