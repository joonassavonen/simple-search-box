import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

const Index = () => {
  const [query, setQuery] = useState("");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>
    </div>
  );
};

export default Index;
