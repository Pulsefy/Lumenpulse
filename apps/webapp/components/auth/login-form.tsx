"use client";

import { useState, useEffect, useRef, Suspense, memo } from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import Link from "next/link";

// Dynamically import icons
const Wallet = dynamic(() => import("lucide-react").then((mod) => mod.Wallet), {
  ssr: false,
});
const Shield = dynamic(() => import("lucide-react").then((mod) => mod.Shield), {
  ssr: false,
});
const Key = dynamic(() => import("lucide-react").then((mod) => mod.Key), {
  ssr: false,
});
const ChevronRight = dynamic(
  () => import("lucide-react").then((mod) => mod.ChevronRight),
  { ssr: false }
);
const Lock = dynamic(() => import("lucide-react").then((mod) => mod.Lock), {
  ssr: false,
});
const User = dynamic(() => import("lucide-react").then((mod) => mod.User), {
  ssr: false,
});
const Mail = dynamic(() => import("lucide-react").then((mod) => mod.Mail), {
  ssr: false,
});
const ArrowLeft = dynamic(
  () => import("lucide-react").then((mod) => mod.ArrowLeft),
  { ssr: false }
);

// Import form components normally first
import SignInForm from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";
import { ResetPasskeyForm } from "./reset-passkey-form";
import { AuthApiService } from "@/lib/auth-service";
import { useToast } from "@/hooks/use-toast";

// Memoized components that don't need frequent re-renders
const FormTitle = memo(
  ({ title, isSignup }: { title: string; isSignup: boolean }) => (
    <h2
      className={`text-3xl font-bold text-white mb-2 form-element ${isSignup ? "pt-4" : ""}`}
    >
      {title}
    </h2>
  )
);
FormTitle.displayName = "FormTitle";

const FormDescription = memo(({ description }: { description: string }) => (
  <p className="text-gray-400 form-element">{description}</p>
));
FormDescription.displayName = "FormDescription";

const TermsFooter = memo(() => (
  <div className="text-xs text-center text-gray-500 form-element">
    By connecting, you agree to our{" "}
    <Link href="/terms" className="text-blue-500 hover:text-[#db74cf]">
      Terms of Service
    </Link>{" "}
    and{" "}
    <Link href="/privacy" className="text-blue-500 hover:text-[#db74cf]">
      Privacy Policy
    </Link>
  </div>
));
TermsFooter.displayName = "TermsFooter";

// Blockchain node component
const BlockchainNode = memo(
  ({
    index,
    className,
    nodeRefs,
  }: {
    index: number;
    className: string;
    nodeRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  }) => (
    <div
      ref={(el) => (nodeRefs.current[index] = el)}
      className={className}
    ></div>
  )
);
BlockchainNode.displayName = "BlockchainNode";

function LoginFormComponent() {
  const [formMode, setFormMode] = useState<"signin" | "signup" | "reset">(
    "signin"
  );
  const [isLoading, setIsLoading] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<(HTMLDivElement | null)[]>([]);
  const { toast } = useToast();

  // Animation for form elements - optimized
  useEffect(() => {
    if (!formRef.current) return;

    const formElements = formRef.current.querySelectorAll(".form-element");
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

    // Group animations to reduce reflows
    tl.fromTo(
      formElements,
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, stagger: 0.05, duration: 0.4 }
    );

    tl.fromTo(
      nodesRef.current.filter(Boolean),
      { scale: 0, opacity: 0 },
      {
        scale: 1,
        opacity: 1,
        stagger: 0.1,
        duration: 0.6,
        ease: "back.out(1.7)",
      },
      "-=0.3" // Start slightly before previous animation ends
    );

    tl.fromTo(
      ".connection-line",
      { scaleX: 0, opacity: 0 },
      {
        scaleX: 1,
        opacity: 0.5,
        stagger: 0.1,
        duration: 0.8,
        ease: "power2.inOut",
      },
      "-=0.4"
    );

    return () => {
      // Clean up animations
      tl.kill();
    };
  }, [formMode]);

  const handleSubmit = async (formData: any) => {
    setIsLoading(true);

    try {
      if (formMode === "signup") {
        await AuthApiService.register(formData);
        toast({
          title: "Account Created",
          description: "Your account has been successfully created. You can now sign in.",
        });
        setFormMode("signin");
      } else if (formMode === "signin") {
        const result = await AuthApiService.login({
          email: formData.email,
          password: formData.passkey, // SignInForm uses passkey as field name
        });
        localStorage.setItem("access_token", result.access_token);
        toast({
          title: "Welcome Back!",
          description: "Successfully signed in.",
        });
        window.location.href = "/dashboard";
      } else if (formMode === "reset") {
        await AuthApiService.forgotPassword(formData.email);
        toast({
          title: "Email Sent",
          description: "If that email is registered, a reset link has been sent.",
        });
        setFormMode("signin");
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "An unexpected error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const changeFormMode = (mode: "signin" | "signup" | "reset") => {
    // Animate form transition
    if (formRef.current) {
      gsap.to(formRef.current, {
        opacity: 0,
        y: -20,
        duration: 0.3,
        onComplete: () => {
          setFormMode(mode);
          gsap.to(formRef.current, {
            opacity: 1,
            y: 0,
            duration: 0.3,
          });
        },
      });
    } else {
      setFormMode(mode);
    }
  };

  const getFormTitle = () => {
    switch (formMode) {
      case "signup":
        return "Join our Community!";
      case "reset":
        return "Reset Passkey";
      default:
        return "Sign In";
    }
  };

  const getFormDescription = () => {
    switch (formMode) {
      case "signup":
        return "";
      case "reset":
        return "Enter your email to receive reset instructions";
      default:
        return "Access your StarkPulse dashboard";
    }
  };

  return (
    <div className="relative">
      <div ref={formRef} className="space-y-6">
        <div className="mb-8 mt-8">
          <FormTitle title={getFormTitle()} isSignup={formMode === "signup"} />
          <FormDescription description={getFormDescription()} />
        </div>

        {formMode === "signup" ? (
          <SignUpForm
            onSubmitAction={handleSubmit}
            isLoading={isLoading}
            onToggleFormAction={() => changeFormMode("signin")}
          />
        ) : formMode === "reset" ? (
          <ResetPasskeyForm
            onSubmitAction={handleSubmit}
            isLoading={isLoading}
            onBackToSignInAction={() => changeFormMode("signin")}
          />
        ) : (
          <>
            <SignInForm
              onSubmitAction={handleSubmit}
              isLoading={isLoading}
              onForgotPassword={() => changeFormMode("reset")}
            />

            <div className="text-center text-gray-400 form-element">
              <p>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => changeFormMode("signup")}
                  className="text-blue-500 hover:text-[#db74cf] focus:outline-none"
                >
                  Create one
                </button>
              </p>
            </div>
          </>
        )}

        <TermsFooter />
      </div>

      {/* Blockchain nodes - reduced number for better performance */}
      <div
        ref={(el) => (nodesRef.current[0] = el)}
        className="absolute top-10 right-10 w-2 h-2 rounded-full bg-blue-500/70 shadow-lg shadow-blue-500/30"
      ></div>
      <div
        ref={(el) => (nodesRef.current[1] = el)}
        className="absolute top-20 right-20 w-3 h-3 rounded-full bg-[#db74cf]/70 shadow-lg shadow-[#db74cf]/30"
      ></div>
      <div
        ref={(el) => (nodesRef.current[2] = el)}
        className="absolute bottom-10 right-10 w-2 h-2 rounded-full bg-blue-500/70 shadow-lg shadow-blue-500/30"
      ></div>
      <div
        ref={(el) => (nodesRef.current[3] = el)}
        className="absolute bottom-20 right-30 w-4 h-4 rounded-full bg-[#db74cf]/70 shadow-lg shadow-[#db74cf]/30"
      ></div>
      <div
        ref={(el) => (nodesRef.current[4] = el)}
        className="absolute top-1/4 right-5 w-2 h-2 rounded-full bg-blue-500/70 shadow-lg shadow-blue-500/30"
      ></div>
      <div
        ref={(el) => (nodesRef.current[5] = el)}
        className="absolute top-1/2 right-1/4 w-6 h-6 rounded-full bg-[#db74cf]/70 shadow-lg shadow-[#db74cf]/30"
      ></div>

      {/* Connection lines - reduced for better performance */}
      <div className="connection-line absolute top-12 right-12 w-20 h-[1px] bg-blue-500 transform origin-left rotate-[45deg]"></div>
      <div className="connection-line absolute top-22 right-22 w-30 h-[1px] bg-[#db74cf] transform origin-left rotate-[120deg]"></div>
      <div className="connection-line absolute bottom-12 right-12 w-20 h-[1px] bg-blue-500 transform origin-left rotate-[-45deg]"></div>
      <div className="connection-line absolute bottom-22 right-32 w-40 h-[1px] bg-[#db74cf] transform origin-left rotate-[60deg]"></div>
      <div className="connection-line absolute top-1/4 right-7 w-30 h-[1px] bg-blue-500 transform origin-left rotate-[90deg]"></div>
      <div className="connection-line absolute top-1/2 right-1/4 w-50 h-[1px] bg-[#db74cf] transform origin-left rotate-[30deg]"></div>
    </div>
  );
}

// Export memoized component
export const LoginForm = memo(LoginFormComponent);
