import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListGroups, 
  useGetRecentActivity, 
  useCreateGroup,
  useSetGroupKey,
  getListGroupsQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MessageCirclePlus, Users, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useEncryption, createAndShareGroupKey } from "@/hooks/use-encryption";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { data: groups, isLoading: groupsLoading } = useListGroups();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();
  const createGroup = useCreateGroup();
  const setGroupKey = useSetGroupKey();
  const queryClient = useQueryClient();
  const identity = useEncryption();
  const { toast } = useToast();

  const [newGroupName, setNewGroupName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || !identity) return;

    setIsCreating(true);
    try {
      const group = await createGroup.mutateAsync({ data: { name: newGroupName } });
      await createAndShareGroupKey({
        groupId: group.id,
        myUserId: group.createdBy,
        myPublicKey: identity.publicKey,
        setGroupKey: (args) => setGroupKey.mutateAsync(args),
      });
      queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
      setNewGroupName("");
      setIsDialogOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Couldn't create group", description: "Please try again." });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-10 bg-background">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Welcome Home</h1>
          <p className="text-muted-foreground mt-1">Catch up with your family groups below.</p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-full shadow-sm">
              <MessageCirclePlus className="w-5 h-5 mr-2" />
              New Family Group
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">Create a New Group</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateGroup} className="space-y-4 pt-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">Group Name</label>
                <Input 
                  id="name" 
                  value={newGroupName} 
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g., The Smiths, Sunday Dinners"
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={isCreating || !identity} className="w-full">
                {isCreating ? "Creating..." : !identity ? "Setting up encryption..." : "Create Group"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-serif font-semibold border-b border-border pb-2">Your Groups</h2>
          {groupsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-muted/50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : groups?.length === 0 ? (
            <Card className="bg-card/50 border-dashed text-center py-10">
              <CardContent>
                <p className="text-muted-foreground mb-4">You aren't in any groups yet.</p>
                <Button variant="outline" onClick={() => setIsDialogOpen(true)}>Create your first group</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {groups?.map(group => (
                <Link key={group.id} href={`/app/groups/${group.id}`}>
                  <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full border-border bg-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="font-serif text-lg flex items-center justify-between">
                        {group.name}
                        <span className="text-xs font-sans font-normal text-muted-foreground flex items-center bg-muted px-2 py-1 rounded-full">
                          <Users className="w-3 h-3 mr-1" />
                          {group.memberCount}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {group.lastMessagePreview ? (
                        <p className="text-sm text-muted-foreground line-clamp-2 italic">
                          "{group.lastMessagePreview}"
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground/50">No messages yet.</p>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-serif font-semibold border-b border-border pb-2">Recent Activity</h2>
          {activityLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-muted/50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : activity?.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">It's quiet around here...</p>
          ) : (
            <div className="space-y-4">
              {activity?.map((item, i) => (
                <Link key={i} href={`/app/groups/${item.groupId}`}>
                  <div className="p-3 rounded-lg hover:bg-muted/50 transition-colors group">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-sm font-medium">{item.senderName}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-xs text-primary mb-1">{item.groupName}</p>
                    <p className="text-sm text-muted-foreground line-clamp-1">{item.content}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
