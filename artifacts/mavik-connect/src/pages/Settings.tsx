import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMyProfile, useUpdateMyProfile, useGetKeyHistory, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Phone, ShieldCheck, Key, Smartphone, Monitor } from "lucide-react";

// Rough, best-effort browser/OS/device-type read from a User-Agent string —
// good enough for "which device was this", not meant to be precise or used
// for any security decision.
function parseUserAgent(ua: string | null): {
  label: string;
  isMobile: boolean;
} {
  if (!ua) return { label: "Unknown device", isMobile: false };

  const isMobile = /Mobi|Android|iPhone|iPad|iPod/.test(ua);

  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /CriOS|Chrome\//.test(ua)
        ? "Chrome"
        : /FxiOS|Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua)
            ? "Safari"
            : "a browser";

  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "";

  const label = os ? `${browser} on ${os}` : browser;
  return { label, isMobile };
}

export default function Settings() {
  const { data: profile, isLoading } = useGetMyProfile();
  const { data: keyHistory } = useGetKeyHistory();
  const { isLoaded, user } = useUser();
  const updateProfile = useUpdateMyProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // --- Name ---
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
  }, [user]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSavingName(true);
    try {
      await user.update({ firstName, lastName });

      const name = [firstName, lastName].filter(Boolean).join(" ").trim();
      if (name) {
        await updateProfile.mutateAsync({ data: { name } });
        queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      }

      toast({ title: "Name updated" });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Couldn't update name",
        description: err?.errors?.[0]?.message ?? "Please try again.",
      });
    } finally {
      setIsSavingName(false);
    }
  };

  // --- Phone number ---
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [pendingPhoneId, setPendingPhoneId] = useState<string | null>(null);
  const [isPhoneBusy, setIsPhoneBusy] = useState(false);

  const primaryPhone = user?.primaryPhoneNumber?.phoneNumber ?? null;

  const handleAddPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !phoneInput.trim()) return;

    setIsPhoneBusy(true);
    try {
      const created = await user.createPhoneNumber({ phoneNumber: phoneInput.trim() });
      await created.prepareVerification();
      setPendingPhoneId(created.id);
      toast({ title: "Code sent", description: "Check your texts for a verification code." });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Couldn't add phone number",
        description: err?.errors?.[0]?.message ?? "Please check the number and try again.",
      });
    } finally {
      setIsPhoneBusy(false);
    }
  };

  const handleVerifyPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !pendingPhoneId || !phoneCode.trim()) return;

    setIsPhoneBusy(true);
    try {
      const phoneNumber = user.phoneNumbers.find((p) => p.id === pendingPhoneId);
      if (!phoneNumber) throw new Error("Phone number not found");

      await phoneNumber.attemptVerification({ code: phoneCode.trim() });
      await user.update({ primaryPhoneNumberId: pendingPhoneId });

      setPendingPhoneId(null);
      setPhoneInput("");
      setPhoneCode("");
      toast({ title: "Phone number added" });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Couldn't verify code",
        description: err?.errors?.[0]?.message ?? "Please check the code and try again.",
      });
    } finally {
      setIsPhoneBusy(false);
    }
  };

  // --- Password ---
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newPassword || newPassword !== confirmPassword) {
      if (newPassword !== confirmPassword) {
        toast({ variant: "destructive", title: "Passwords don't match" });
      }
      return;
    }

    setIsSavingPassword(true);
    try {
      await user.updatePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated" });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Couldn't update password",
        description: err?.errors?.[0]?.message ?? "Check your current password and try again.",
      });
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (isLoading || !profile || !isLoaded) {
    return (
      <div className="p-10 space-y-6 max-w-2xl mx-auto w-full">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-64 bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-6 max-w-2xl mx-auto w-full">
      <div>
        <h1 className="text-3xl font-serif font-bold">Profile Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your personal information.</p>
      </div>

      {/* Overview */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-6">
            <Avatar className="w-20 h-20 border-4 border-background shadow-sm">
              {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={profile.name} /> : null}
              <AvatarFallback className="text-2xl bg-primary/10 text-primary">
                {profile.name?.charAt(0)?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-xl font-bold">{profile.name}</h2>
              <p className="text-muted-foreground">{profile.email}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Member since {format(new Date(profile.createdAt), "MMMM d, yyyy")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Name */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Name</CardTitle>
          <CardDescription>How your name appears to family members.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveName} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={isSavingName}>
              {isSavingName ? "Saving..." : "Save Name"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Phone number */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Phone className="w-4 h-4" /> Phone Number
          </CardTitle>
          <CardDescription>Optional — used for account security.</CardDescription>
        </CardHeader>
        <CardContent>
          {primaryPhone && !pendingPhoneId ? (
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              {primaryPhone}
            </div>
          ) : pendingPhoneId ? (
            <form onSubmit={handleVerifyPhone} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phoneCode">Enter the code we texted you</Label>
                <Input id="phoneCode" value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} placeholder="123456" autoFocus />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={isPhoneBusy || !phoneCode.trim()}>
                  {isPhoneBusy ? "Verifying..." : "Verify"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setPendingPhoneId(null); setPhoneCode(""); }}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddPhone} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="+1 555 123 4567"
                />
                <p className="text-xs text-muted-foreground">Include your country code, e.g. +1 for the US.</p>
              </div>
              <Button type="submit" disabled={isPhoneBusy || !phoneInput.trim()}>
                {isPhoneBusy ? "Sending code..." : "Add Phone Number"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Password</CardTitle>
          <CardDescription>Change your account password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <Separator />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={isSavingPassword || !currentPassword || !newPassword || !confirmPassword}
            >
              {isSavingPassword ? "Updating..." : "Change Password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Key activity */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Key className="w-4 h-4" /> Encryption Key Activity
          </CardTitle>
          <CardDescription>
            A timeline of when your message-encryption key was set up or changed, and roughly where from.
            This app keeps one active key per account rather than tracking individual devices, so this is a
            history for your own reference — not a list you can revoke devices from. If you don't recognize
            an entry, the safest step is changing your password above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!keyHistory || keyHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No key activity recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {keyHistory.map((entry, i) => {
                const { label, isMobile } = parseUserAgent(entry.userAgent);
                const isMostRecent = i === 0;
                const DeviceIcon = isMobile ? Smartphone : Monitor;
                return (
                  <li
                    key={i}
                    className="flex items-center gap-3 text-sm border-b border-border last:border-0 py-2.5 first:pt-0 last:pb-0"
                  >
                    <DeviceIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground truncate">{label}</span>
                        {isMostRecent && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0">
                            Most recent
                          </span>
                        )}
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {format(new Date(entry.occurredAt), "MMM d, yyyy 'at' h:mm a")}
                        {" · "}
                        {formatDistanceToNow(new Date(entry.occurredAt), { addSuffix: true })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
