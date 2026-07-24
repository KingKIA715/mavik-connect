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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import {
  getQuietHours,
  setQuietHours,
  DEFAULT_QUIET_HOURS,
  type QuietHours,
} from "@/lib/quiet-hours";
import { clearSearchIndex } from "@/lib/search-index";
import {
  Phone,
  Key,
  Smartphone,
  Monitor,
  Sun,
  Moon,
  Palette,
  Bell,
} from "lucide-react";

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
  const { theme, setTheme } = useTheme();
  const {
    isSupported: pushIsSupported,
    permission: pushPermission,
    isSubscribed: pushIsSubscribed,
    enable: enablePush,
    disable: disablePush,
  } = usePushNotifications();
  const [isTogglingPush, setIsTogglingPush] = useState(false);
  const [quietHours, setQuietHoursState] =
    useState<QuietHours>(DEFAULT_QUIET_HOURS);

  useEffect(() => {
    getQuietHours()
      .then(setQuietHoursState)
      .catch(() => {});
  }, []);

  const updateQuietHours = (patch: Partial<QuietHours>) => {
    const next = { ...quietHours, ...patch };
    setQuietHoursState(next);
    setQuietHours(next).catch(() => {});
  };

  const handleTogglePush = async (checked: boolean) => {
    setIsTogglingPush(true);
    try {
      if (checked) {
        const ok = await enablePush();
        if (!ok) {
          toast({
            variant: "destructive",
            title: "Couldn't enable notifications",
            description:
              pushPermission === "denied"
                ? "Notifications are blocked in your browser settings."
                : "Please try again.",
          });
        }
      } else {
        await disablePush();
      }
    } finally {
      setIsTogglingPush(false);
    }
  };

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
    <div className="h-full overflow-y-auto">
      <div className="px-6 md:px-10 pt-4 md:pt-6 pb-3 max-w-2xl mx-auto w-full space-y-3">
        <h1 className="text-xl sm:text-2xl font-serif font-bold">
          Profile Settings
        </h1>

        {/* Overview — stacks on narrow screens and truncates long
            names/emails instead of overflowing the card. */}
        <Card>
          <CardContent className="py-3 px-4 sm:py-4">
            <div className="flex items-center gap-3 sm:gap-4 text-left">
              <Avatar className="w-12 h-12 border-2 border-background shadow-sm flex-shrink-0">
                {profile.avatarUrl ? (
                  <AvatarImage src={profile.avatarUrl} alt={profile.name} />
                ) : null}
                <AvatarFallback className="text-base bg-primary/10 text-primary">
                  {(profile.name || profile.email).charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold truncate">
                  {profile.name || "Unnamed"}
                </h2>
                <p className="text-sm text-muted-foreground truncate">
                  {profile.email}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="profile">
        <div className="px-6 md:px-10 max-w-2xl mx-auto w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1 h-auto p-1.5">
            <TabsTrigger value="profile" className="text-xs sm:text-sm px-2 py-1.5">Profile</TabsTrigger>
            <TabsTrigger value="appearance" className="text-xs sm:text-sm px-2 py-1.5">Appearance</TabsTrigger>
            <TabsTrigger value="notifications" className="text-xs sm:text-sm px-2 py-1.5">Notifications</TabsTrigger>
            <TabsTrigger value="security" className="text-xs sm:text-sm px-2 py-1.5">Security</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="profile" className="mt-0">
          <div className="px-6 md:px-10 py-4 max-w-2xl mx-auto w-full space-y-6">
            {/* Profile — plain fields on this app's own users table. No Clerk
                routing, no SMS/OTP verification for the phone number. */}
            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <Phone className="w-4 h-4" /> Profile
                </CardTitle>
                <CardDescription>
                  Your name (shown to others in your conversations) and an optional phone
                  number.
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
                      Optional. Include your country code, e.g. +1 for the US.
                      Not verified — just stored on your profile.
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
          </div>
        </TabsContent>

        <TabsContent value="appearance" className="mt-0">
          <div className="px-6 md:px-10 py-4 max-w-2xl mx-auto w-full space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <Palette className="w-4 h-4" /> Appearance
                </CardTitle>
                <CardDescription>
                  Choose how Mavik Connect looks on this device.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ToggleGroup
                  type="single"
                  value={theme}
                  onValueChange={(value) => {
                    if (value) setTheme(value as "light" | "dark" | "system");
                  }}
                  className="justify-start gap-2"
                >
                  <ToggleGroupItem
                    value="light"
                    aria-label="Light theme"
                    className="gap-1.5 px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    <Sun className="w-4 h-4" /> Light
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="dark"
                    aria-label="Dark theme"
                    className="gap-1.5 px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    <Moon className="w-4 h-4" /> Dark
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="system"
                    aria-label="Match system theme"
                    className="gap-1.5 px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    <Monitor className="w-4 h-4" /> System
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground mt-3">
                  "System" follows your device's light/dark setting
                  automatically.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="notifications" className="mt-0">
          <div className="px-6 md:px-10 py-4 max-w-2xl mx-auto w-full space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <Bell className="w-4 h-4" /> Notifications
                </CardTitle>
                <CardDescription>
                  Get notified about new messages and calls even when the app
                  isn't open.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!pushIsSupported ? (
                  <p className="text-sm text-muted-foreground">
                    Notifications aren't supported in this browser.
                  </p>
                ) : pushPermission === "denied" ? (
                  <p className="text-sm text-muted-foreground">
                    Notifications are blocked for this site in your browser
                    settings. You'll need to allow them there before this can be
                    turned on.
                  </p>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">
                        Message &amp; call notifications
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        We'll never show the content of a message — just who
                        it's from.
                      </p>
                    </div>
                    <Switch
                      checked={pushIsSubscribed}
                      disabled={isTogglingPush}
                      onCheckedChange={handleTogglePush}
                      aria-label="Toggle notifications"
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <Bell className="w-4 h-4" /> Quiet hours
                </CardTitle>
                <CardDescription>
                  Pause message notifications during set hours — calls still
                  ring through either way.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium">Enable quiet hours</p>
                  <Switch
                    checked={quietHours.enabled}
                    onCheckedChange={(enabled) =>
                      updateQuietHours({ enabled })
                    }
                    aria-label="Toggle quiet hours"
                  />
                </div>
                {quietHours.enabled && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">
                        From
                      </Label>
                      <Input
                        type="time"
                        value={`${String(quietHours.startHour).padStart(2, "0")}:00`}
                        onChange={(e) =>
                          updateQuietHours({
                            startHour: parseInt(
                              e.target.value.split(":")[0],
                              10,
                            ),
                          })
                        }
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">
                        Until
                      </Label>
                      <Input
                        type="time"
                        value={`${String(quietHours.endHour).padStart(2, "0")}:00`}
                        onChange={(e) =>
                          updateQuietHours({
                            endHour: parseInt(
                              e.target.value.split(":")[0],
                              10,
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="security" className="mt-0">
          <div className="px-6 md:px-10 py-4 max-w-2xl mx-auto w-full space-y-6">
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
                      <Label htmlFor="confirmPassword">
                        Confirm new password
                      </Label>
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
                  changed, and roughly where from. This app keeps one active key
                  per account rather than tracking individual devices, so this
                  is a history for your own reference — not a list you can
                  revoke devices from. If you don't recognize an entry, the
                  safest step is changing your password above.
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
                      const { label, isMobile } = parseUserAgent(
                        entry.userAgent,
                      );
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
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] font-medium px-1.5 py-0.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 flex-shrink-0"
                                >
                                  Most recent
                                </Badge>
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

            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-lg">
                  Local search data
                </CardTitle>
                <CardDescription>
                  Message search works entirely on this device — messages
                  are end-to-end encrypted, so nothing is ever searchable
                  on our servers. This clears the plaintext search index
                  stored on this device only; it doesn't delete any
                  messages or affect other devices.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await clearSearchIndex();
                    toast({ title: "Local search data cleared" });
                  }}
                >
                  Clear local search data
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
