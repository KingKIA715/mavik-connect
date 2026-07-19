import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyProfile,
  useUpdateMyProfile,
  useGetKeyHistory,
  getGetMyProfileQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Phone, Key, Smartphone, Monitor } from "lucide-react";

// Format-only E.164 check, mirrored from the server-side validation
// (see UpdateMyProfileBody in the API spec) so the form can show an inline
// error before round-tripping to the API. Not a verification that the
// number actually belongs to the user — just a shape check.
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

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

  // --- Name + phone: plain profile fields on this app's own users table.
  // No Clerk routing, no SMS/OTP verification — see PATCH /users/me.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.firstName ?? "");
    setLastName(profile.lastName ?? "");
    setPhoneInput(profile.phoneNumber ?? "");
  }, [profile]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    const trimmedPhone = phoneInput.trim();
    if (trimmedPhone && !E164_PATTERN.test(trimmedPhone)) {
      setPhoneError("Include a country code, e.g. +14155551234.");
      return;
    }
    setPhoneError(null);

    setIsSavingProfile(true);
    try {
      await updateProfile.mutateAsync({
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phoneNumber: trimmedPhone || null,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({ title: "Profile updated" });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Couldn't update profile",
        description: err?.message ?? "Please try again.",
      });
    } finally {
      setIsSavingProfile(false);
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
        description:
          err?.errors?.[0]?.message ??
          "Check your current password and try again.",
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
        <p className="text-muted-foreground mt-1">
          Manage your personal information.
        </p>
      </div>

      {/* Overview */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-6">
            <Avatar className="w-20 h-20 border-4 border-background shadow-sm">
              {profile.avatarUrl ? (
                <AvatarImage src={profile.avatarUrl} alt={profile.name} />
              ) : null}
              <AvatarFallback className="text-2xl bg-primary/10 text-primary">
                {profile.name?.charAt(0)?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-xl font-bold">{profile.name}</h2>
              <p className="text-muted-foreground">{profile.email}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Member since{" "}
                {format(new Date(profile.createdAt), "MMMM d, yyyy")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile — plain fields on this app's own users table. No Clerk
          routing, no SMS/OTP verification for the phone number. */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Phone className="w-4 h-4" /> Profile
          </CardTitle>
          <CardDescription>
            Your name (shown to family members) and an optional phone number.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                type="tel"
                value={phoneInput}
                onChange={(e) => {
                  setPhoneInput(e.target.value);
                  setPhoneError(null);
                }}
                placeholder="+14155551234"
              />
              <p className="text-xs text-muted-foreground">
                Optional. Include your country code, e.g. +1 for the US. Not
                verified — just stored on your profile.
              </p>
              {phoneError && (
                <p className="text-xs text-destructive">{phoneError}</p>
              )}
            </div>
            <Button
              type="submit"
              disabled={
                isSavingProfile || !firstName.trim() || !lastName.trim()
              }
            >
              {isSavingProfile ? "Saving..." : "Save Profile"}
            </Button>
          </form>
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
              disabled={
                isSavingPassword ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
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
            A timeline of when your message-encryption key was set up or
            changed, and roughly where from. This app keeps one active key per
            account rather than tracking individual devices, so this is a
            history for your own reference — not a list you can revoke devices
            from. If you don't recognize an entry, the safest step is changing
            your password above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!keyHistory || keyHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No key activity recorded yet.
            </p>
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
                        <span className="text-foreground truncate">
                          {label}
                        </span>
                        {isMostRecent && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0">
                            Most recent
                          </span>
                        )}
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {format(
                          new Date(entry.occurredAt),
                          "MMM d, yyyy 'at' h:mm a",
                        )}
                        {" · "}
                        {formatDistanceToNow(new Date(entry.occurredAt), {
                          addSuffix: true,
                        })}
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
