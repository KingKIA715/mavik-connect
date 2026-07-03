import { useGetMyProfile } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { format } from "date-fns";

export default function Settings() {
  const { data: profile, isLoading } = useGetMyProfile();

  if (isLoading || !profile) {
    return (
      <div className="p-10 space-y-6 max-w-2xl mx-auto w-full">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-64 bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-8 max-w-2xl mx-auto w-full">
      <div>
        <h1 className="text-3xl font-serif font-bold">Profile Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your personal information.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Account Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-6">
            <Avatar className="w-24 h-24 border-4 border-background shadow-sm">
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
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-border">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Member Since</p>
              <p className="text-sm">{format(new Date(profile.createdAt), "MMMM d, yyyy")}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Account ID</p>
              <p className="text-sm font-mono bg-muted px-2 py-1 rounded inline-block">{profile.id}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
