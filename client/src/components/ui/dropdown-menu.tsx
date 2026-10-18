import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

const DropdownMenu = MenuPrimitive.Root;
const DropdownMenuTrigger = MenuPrimitive.Trigger;
const DropdownMenuGroup = MenuPrimitive.Group;
const DropdownMenuPortal = MenuPrimitive.Portal;

const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  MenuPrimitive.Popup.Props & { sideOffset?: number; align?: "start" | "center" | "end" }
>(({ className, sideOffset = 4, align = "start", children, ...props }, ref) => (
  <DropdownMenuPortal>
    <MenuPrimitive.Positioner sideOffset={sideOffset} align={align} className="z-50">
      <MenuPrimitive.Popup
        ref={ref}
        data-slot="dropdown-menu-content"
        className={cn(
          "min-w-32 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md transition-all outline-none",
          className
        )}
        {...props}
      >
        {children}
      </MenuPrimitive.Popup>
    </MenuPrimitive.Positioner>
  </DropdownMenuPortal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  MenuPrimitive.Item.Props & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <MenuPrimitive.Item
    ref={ref}
    data-slot="dropdown-menu-item"
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus:bg-muted focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  MenuPrimitive.Separator.Props
>(({ className, ...props }, ref) => (
  <MenuPrimitive.Separator
    ref={ref}
    data-slot="dropdown-menu-separator"
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  MenuPrimitive.GroupLabel.Props & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <MenuPrimitive.GroupLabel
    ref={ref}
    data-slot="dropdown-menu-label"
    className={cn(
      "px-2 py-1.5 text-xs font-semibold text-muted-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuPortal,
};
