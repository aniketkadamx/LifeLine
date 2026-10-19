import * as React from "react";
import {
  Pill,
  Search,
  Plus,
  AlertTriangle,
  Edit2,
  Check,
  X,
  ArrowUpDown,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";

export interface MedicineCatalogItem {
  _id: string;
  name: string;
  genericName: string;
  dosageForm: string;
  strength?: string;
  manufacturer: string;
  prescriptionRequired?: boolean;
}

export interface InventoryRecord {
  _id: string;
  pharmacyId: string;
  medicineId: {
    _id: string;
    name: string;
    genericName?: string;
    dosageForm?: string;
    strength?: string;
    manufacturer?: string;
    prescriptionRequired?: boolean;
  };
  quantity: number;
  reservedQuantity: number;
  price?: number;
  unitPrice?: number;
  batchNumber?: string;
  expiryDate?: string;
  isAvailable: boolean;
  lowStockThreshold: number;
  reorderQuantity: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface InventoryListResponse {
  success: boolean;
  data: {
    inventory: InventoryRecord[];
    total: number;
    page: number;
    limit: number;
  };
}

export function InventoryPage() {
  const [items, setItems] = React.useState<InventoryRecord[]>([]);
  const [totalCount, setTotalCount] = React.useState<number>(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [successNotice, setSuccessNotice] = React.useState<string | null>(null);

  // Filters & Search
  const [searchTerm, setSearchTerm] = React.useState("");
  const [filterMode, setFilterMode] = React.useState<"all" | "inStock" | "lowStock">("all");
  const [sortField, setSortField] = React.useState<"createdAt" | "price" | "quantity" | "updatedAt">("updatedAt");
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc");

  // Inline Quick Editing State
  const [editingItemId, setEditingItemId] = React.useState<string | null>(null);
  const [editQuantity, setEditQuantity] = React.useState<string>("");
  const [editPrice, setEditPrice] = React.useState<string>("");
  const [editBatch, setEditBatch] = React.useState<string>("");
  const [isSavingInline, setIsSavingInline] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  // Add Medicine Modal State
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [catalogSearch, setCatalogSearch] = React.useState("");
  const [catalogResults, setCatalogResults] = React.useState<MedicineCatalogItem[]>([]);
  const [isSearchingCatalog, setIsSearchingCatalog] = React.useState(false);
  const [selectedMedicine, setSelectedMedicine] = React.useState<MedicineCatalogItem | null>(null);

  const [addQuantity, setAddQuantity] = React.useState("100");
  const [addPrice, setAddPrice] = React.useState("150.00");
  const [addBatch, setAddBatch] = React.useState("");
  const [addExpiry, setAddExpiry] = React.useState("");
  const [addThreshold, setAddThreshold] = React.useState("15");
  const [isAddingStock, setIsAddingStock] = React.useState(false);
  const [addModalError, setAddModalError] = React.useState<string | null>(null);

  // Fetch Inventory List
  const fetchInventory = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);

    const params: Record<string, string | number | boolean> = {
      limit: 50,
      sort: sortField,
      order: sortOrder,
    };

    if (searchTerm.trim()) {
      params.search = searchTerm.trim();
    }

    if (filterMode === "inStock") {
      params.inStockOnly = true;
    }

    try {
      const res = await api.get<any>("/pharmacies/me/inventory", { params });
      const data = res.data !== undefined ? res.data : res;
      const inventoryList: InventoryRecord[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.inventory)
        ? data.inventory
        : Array.isArray(data?.items)
        ? data.items
        : [];

      // Filter locally for lowStock if selected
      if (filterMode === "lowStock") {
        const filtered = inventoryList.filter(
          (item) => item.quantity <= (item.lowStockThreshold || 10)
        );
        setItems(filtered);
        setTotalCount(filtered.length);
      } else {
        setItems(inventoryList);
        setTotalCount(res.meta?.total ?? data.total ?? inventoryList.length);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to load pharmacy inventory.");
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to retrieve pharmacy inventory records.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [searchTerm, filterMode, sortField, sortOrder]);

  React.useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  // Handle Search Input (debounce / keypress)
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchInventory();
  };

  // Start Inline Edit
  const handleStartEdit = (item: InventoryRecord) => {
    setEditingItemId(item._id);
    setEditQuantity(String(item.quantity));
    setEditPrice(String(item.unitPrice ?? item.price ?? 0));
    setEditBatch(item.batchNumber || "");
    setInlineError(null);
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setInlineError(null);
  };

  // Save Inline Edit via PATCH
  const handleSaveInline = async (item: InventoryRecord) => {
    const qtyNum = parseInt(editQuantity, 10);
    const priceNum = parseFloat(editPrice);

    if (isNaN(qtyNum) || qtyNum < 0) {
      setInlineError("Stock quantity must be a non-negative integer.");
      return;
    }

    if (isNaN(priceNum) || priceNum < 0.01) {
      setInlineError("Selling price must be at least ₹0.01.");
      return;
    }

    setIsSavingInline(true);
    setInlineError(null);

    try {
      const updatePayload: Record<string, unknown> = {
        quantity: qtyNum,
        price: priceNum,
      };

      if (editBatch.trim()) {
        updatePayload.batchNumber = editBatch.trim();
      }

      const res = await api.patch<{
        success: boolean;
        data: InventoryRecord;
      }>(`/pharmacies/me/inventory/${item._id}`, updatePayload);

      const updated = res.data;

      // Reconcile state
      setItems((prev) =>
        prev.map((it) => (it._id === item._id ? { ...it, ...updated } : it))
      );
      setEditingItemId(null);
      setSuccessNotice(`Updated stock for ${item.medicineId?.name || "medicine"} successfully.`);
      setTimeout(() => setSuccessNotice(null), 4000);
    } catch (err: unknown) {
      // Preserve inputs on error so user doesn't lose modifications
      if (err instanceof ApiError) {
        setInlineError(err.message || "Failed to update inventory item.");
      } else if (err instanceof Error) {
        setInlineError(err.message);
      } else {
        setInlineError("Failed to update item. Please try again.");
      }
    } finally {
      setIsSavingInline(false);
    }
  };

  // Master Catalog Search for Adding New Stock
  const handleSearchCatalog = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = catalogSearch.trim();
    if (!query) return;

    setIsSearchingCatalog(true);
    setAddModalError(null);

    try {
      const res = await api.get<{
        success: boolean;
        data: MedicineCatalogItem[];
      }>("/medicines", {
        params: { search: query, limit: 10 },
      });

      const list = res.data !== undefined ? res.data : res;
      const medList = Array.isArray(list)
        ? list
        : Array.isArray((list as any)?.medicines)
        ? (list as any).medicines
        : Array.isArray((list as any)?.items)
        ? (list as any).items
        : [];
      setCatalogResults(medList);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setAddModalError(err.message || "Catalog search failed.");
      } else {
        setAddModalError("Could not query master medicine catalog.");
      }
    } finally {
      setIsSearchingCatalog(false);
    }
  };

  // Submit Add to Stock
  const handleAddMedicineToStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedicine) {
      setAddModalError("Please select a medicine from the catalog search results.");
      return;
    }

    const qty = parseInt(addQuantity, 10);
    const prc = parseFloat(addPrice);
    const thresh = parseInt(addThreshold, 10);

    if (isNaN(qty) || qty < 0) {
      setAddModalError("Quantity must be a valid non-negative number.");
      return;
    }
    if (isNaN(prc) || prc < 0.01) {
      setAddModalError("Price must be at least ₹0.01.");
      return;
    }

    setIsAddingStock(true);
    setAddModalError(null);

    try {
      const payload: Record<string, unknown> = {
        medicineId: selectedMedicine._id,
        quantity: qty,
        price: prc,
        lowStockThreshold: isNaN(thresh) ? 10 : thresh,
      };

      if (addBatch.trim()) {
        payload.batchNumber = addBatch.trim();
      }
      if (addExpiry.trim()) {
        payload.expiryDate = new Date(addExpiry).toISOString();
      }

      await api.post("/pharmacies/me/inventory", payload);

      setIsAddModalOpen(false);
      setSelectedMedicine(null);
      setCatalogSearch("");
      setCatalogResults([]);
      setSuccessNotice(`Successfully added ${selectedMedicine.name} to pharmacy stock.`);
      setTimeout(() => setSuccessNotice(null), 4000);
      fetchInventory();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setAddModalError(err.message || "Failed to register medicine into stock.");
      } else if (err instanceof Error) {
        setAddModalError(err.message);
      } else {
        setAddModalError("Server error adding medicine to inventory.");
      }
    } finally {
      setIsAddingStock(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="pharmacy-inventory-page">
      {/* HEADER WITH TITLE & ACTION */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Pill className="size-6 text-primary" /> Pharmaceutical Stock & Inventory Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your drug inventory, perform inline stock and retail price adjustments, and monitor expiration dates.
          </p>
        </div>

        <Button
          onClick={() => {
            setIsAddModalOpen(true);
            setAddModalError(null);
          }}
          className="gap-1.5"
          data-testid="open-add-stock-modal-btn"
        >
          <Plus className="size-4" /> Add Medicine to Stock
        </Button>
      </div>

      {/* SUCCESS BANNER */}
      {successNotice && (
        <div
          className="rounded-lg border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 p-3.5 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2"
          data-testid="inventory-success-banner"
        >
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{successNotice}</span>
        </div>
      )}

      {/* ERROR BANNER */}
      {errorMsg && (
        <ErrorAlert
          title="Inventory Error"
          message={errorMsg}
          onRetry={fetchInventory}
          data-testid="inventory-error-alert"
        />
      )}

      {/* FILTER & SEARCH TOOLBAR */}
      <Card className="border border-border shadow-xs">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3">
            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-80">
              <div className="relative w-full">
                <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search medicine name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 text-xs h-8"
                  data-testid="inventory-search-input"
                />
              </div>
              <Button type="submit" size="sm" variant="secondary" className="h-8 text-xs shrink-0" data-testid="inventory-search-submit">
                Search
              </Button>
            </form>

            {/* Filter Buttons */}
            <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
              <Button
                variant={filterMode === "all" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setFilterMode("all")}
                data-testid="filter-all-stock-btn"
              >
                All Items ({totalCount})
              </Button>
              <Button
                variant={filterMode === "inStock" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setFilterMode("inStock")}
                data-testid="filter-in-stock-btn"
              >
                In Stock Only
              </Button>
              <Button
                variant={filterMode === "lowStock" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800"
                onClick={() => setFilterMode("lowStock")}
                data-testid="filter-low-stock-btn"
              >
                <AlertTriangle className="size-3 mr-1" /> Low Stock
              </Button>

              {/* Sort Selector */}
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as any)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="inventory-sort-select"
              >
                <option value="updatedAt">Sort: Recent Update</option>
                <option value="quantity">Sort: Stock Quantity</option>
                <option value="price">Sort: Unit Price</option>
                <option value="createdAt">Sort: Date Added</option>
              </select>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                title={`Order: ${sortOrder.toUpperCase()}`}
                data-testid="inventory-order-toggle"
              >
                <ArrowUpDown className="size-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* INVENTORY TABLE OR FEEDBACK */}
      {isLoading ? (
        <div className="space-y-2.5" data-testid="inventory-loading">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="h-16 w-full rounded-xl bg-muted/40 animate-pulse border border-border/50" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No Inventory Items Found"
          description={
            searchTerm
              ? `No medicines in your inventory match the query "${searchTerm}". Try another search term or stock new catalog items.`
              : "Your pharmacy has no registered stock in this view. Click 'Add Medicine to Stock' to get started."
          }
          icon={Pill}
          actionLabel="Add Medicine"
          onAction={() => setIsAddModalOpen(true)}
          data-testid="inventory-empty-state"
        />
      ) : (
        <Card className="border border-border shadow-xs overflow-hidden" data-testid="inventory-table-container">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                <tr>
                  <th className="p-3">Medicine Details</th>
                  <th className="p-3">Batch & Expiry</th>
                  <th className="p-3">Available Stock</th>
                  <th className="p-3">Retail Price</th>
                  <th className="p-3">Stock Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map((item) => {
                  const isEditing = editingItemId === item._id;
                  const isLow = item.quantity > 0 && item.quantity <= (item.lowStockThreshold || 10);
                  const isOut = item.quantity === 0;

                  return (
                    <tr
                      key={item._id}
                      className={isEditing ? "bg-primary/5" : "hover:bg-muted/20"}
                      data-testid={`inventory-item-row-${item._id}`}
                    >
                      {/* Medicine Details */}
                      <td className="p-3">
                        <div className="font-semibold text-foreground">
                          {item.medicineId?.name || "Catalog Medicine"}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <span className="capitalize">{item.medicineId?.dosageForm?.toLowerCase() || "Medicine"}</span>
                          {item.medicineId?.strength && <span>· {item.medicineId.strength}</span>}
                          {item.medicineId?.prescriptionRequired && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-600 border-amber-300">
                              Rx Required
                            </Badge>
                          )}
                        </div>
                      </td>

                      {/* Batch & Expiry */}
                      <td className="p-3">
                        {isEditing ? (
                          <Input
                            value={editBatch}
                            onChange={(e) => setEditBatch(e.target.value)}
                            placeholder="Batch No."
                            className="h-7 text-xs font-mono w-28"
                            data-testid={`edit-batch-input-${item._id}`}
                          />
                        ) : (
                          <div>
                            <div className="font-mono text-xs">{item.batchNumber || "—"}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {item.expiryDate ? `Exp: ${new Date(item.expiryDate).toLocaleDateString()}` : "No expiry set"}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Stock Quantity */}
                      <td className="p-3">
                        {isEditing ? (
                          <div className="space-y-1">
                            <Input
                              type="number"
                              min="0"
                              value={editQuantity}
                              onChange={(e) => setEditQuantity(e.target.value)}
                              className="h-7 text-xs font-bold w-24"
                              data-testid={`edit-qty-input-${item._id}`}
                            />
                            <span className="text-[10px] text-muted-foreground">Threshold: {item.lowStockThreshold || 10}</span>
                          </div>
                        ) : (
                          <div>
                            <div className={`font-bold text-xs ${isOut ? "text-destructive" : isLow ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                              {item.quantity} units
                            </div>
                            {item.reservedQuantity > 0 && (
                              <div className="text-[10px] text-muted-foreground">
                                {item.reservedQuantity} reserved in orders
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Selling Retail Price */}
                      <td className="p-3">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs">₹</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              className="h-7 text-xs font-bold w-24"
                              data-testid={`edit-price-input-${item._id}`}
                            />
                          </div>
                        ) : (
                          <div className="font-semibold text-foreground">
                            ₹{(item.unitPrice ?? item.price ?? 0).toFixed(2)}
                          </div>
                        )}
                      </td>

                      {/* Stock Status */}
                      <td className="p-3">
                        {isOut ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Out of Stock
                          </Badge>
                        ) : isLow ? (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 dark:text-amber-400">
                            Low Stock ({item.quantity})
                          </Badge>
                        ) : (
                          <Badge variant="default" className="text-[10px] bg-emerald-600">
                            In Stock
                          </Badge>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => handleSaveInline(item)}
                              disabled={isSavingInline}
                              data-testid={`save-inline-btn-${item._id}`}
                              title="Save changes"
                            >
                              {isSavingInline ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-muted-foreground"
                              onClick={handleCancelEdit}
                              disabled={isSavingInline}
                              data-testid={`cancel-inline-btn-${item._id}`}
                              title="Cancel"
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleStartEdit(item)}
                            data-testid={`edit-stock-btn-${item._id}`}
                          >
                            <Edit2 className="size-3" /> Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Inline Edit Error Message */}
          {inlineError && (
            <div className="p-3 border-t border-destructive/20 bg-destructive/10 text-destructive text-xs flex items-center justify-between" data-testid="inline-edit-error">
              <span>{inlineError}</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs p-1" onClick={() => setInlineError(null)}>
                Dismiss
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* ADD MEDICINE TO STOCK MODAL */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-xl p-0 overflow-hidden" data-testid="add-stock-modal">
          <DialogHeader className="p-5 pb-3 border-b border-border bg-muted/20">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Plus className="size-5 text-primary" /> Add Medicine to Pharmacy Inventory
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Search the master drug catalog and register stock quantity and retail pricing for your location.
            </DialogDescription>
          </DialogHeader>

          <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
            {addModalError && (
              <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs" data-testid="add-modal-error">
                {addModalError}
              </div>
            )}

            {/* Catalog Search Input */}
            <form onSubmit={handleSearchCatalog} className="space-y-2">
              <Label className="text-xs font-semibold">1. Search Master Medicine Catalog *</Label>
              <div className="flex items-center gap-2">
                <div className="relative w-full">
                  <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by brand or generic name (e.g. Paracetamol, Amoxicillin)..."
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    className="pl-8 text-xs"
                    data-testid="catalog-search-input"
                  />
                </div>
                <Button type="submit" size="sm" disabled={isSearchingCatalog} data-testid="catalog-search-btn">
                  {isSearchingCatalog ? <Loader2 className="size-3.5 animate-spin" /> : "Find"}
                </Button>
              </div>
            </form>

            {/* Catalog Results Dropdown / List */}
            {catalogResults.length > 0 && !selectedMedicine && (
              <div className="rounded-xl border border-border bg-card divide-y divide-border/60 max-h-48 overflow-y-auto" data-testid="catalog-results-list">
                {catalogResults.map((med) => (
                  <button
                    key={med._id}
                    type="button"
                    onClick={() => {
                      setSelectedMedicine(med);
                      setCatalogResults([]);
                    }}
                    className="w-full text-left p-3 hover:bg-muted/40 transition-colors flex items-center justify-between"
                    data-testid={`catalog-item-${med._id}`}
                  >
                    <div>
                      <div className="text-xs font-bold text-foreground">{med.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {med.genericName} · {med.dosageForm} {med.strength && `· ${med.strength}`}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      Select
                    </Badge>
                  </button>
                ))}
              </div>
            )}

            {/* Selected Medicine Chip */}
            {selectedMedicine && (
              <div className="p-3 rounded-xl border border-primary/30 bg-primary/5 flex items-center justify-between" data-testid="selected-medicine-card">
                <div>
                  <div className="text-xs font-bold text-foreground">{selectedMedicine.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Generic: {selectedMedicine.genericName} · Form: {selectedMedicine.dosageForm} · Mfr: {selectedMedicine.manufacturer}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setSelectedMedicine(null)}
                >
                  Change
                </Button>
              </div>
            )}

            {/* Stock Parameters Form */}
            <form onSubmit={handleAddMedicineToStock} className="space-y-3 pt-2 border-t border-border">
              <div className="text-xs font-semibold text-foreground">
                2. Stock & Pricing Configuration
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold">Initial Stock Quantity *</Label>
                  <Input
                    type="number"
                    min="0"
                    value={addQuantity}
                    onChange={(e) => setAddQuantity(e.target.value)}
                    className="text-xs"
                    data-testid="add-stock-quantity-input"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold">Selling Price (₹ per unit) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={addPrice}
                    onChange={(e) => setAddPrice(e.target.value)}
                    className="text-xs"
                    data-testid="add-stock-price-input"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold">Batch Number (Optional)</Label>
                  <Input
                    placeholder="e.g. BATCH-2026-X"
                    value={addBatch}
                    onChange={(e) => setAddBatch(e.target.value)}
                    className="text-xs font-mono"
                    data-testid="add-stock-batch-input"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold">Expiration Date (Optional)</Label>
                  <Input
                    type="date"
                    value={addExpiry}
                    onChange={(e) => setAddExpiry(e.target.value)}
                    className="text-xs"
                    data-testid="add-stock-expiry-input"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-[11px] font-semibold">Low-Stock Alert Threshold (Units)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={addThreshold}
                    onChange={(e) => setAddThreshold(e.target.value)}
                    className="text-xs"
                    data-testid="add-stock-threshold-input"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Warning badge will trigger on the dashboard when stock drops below this level.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isAddingStock}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isAddingStock || !selectedMedicine}
                  data-testid="submit-add-stock-btn"
                >
                  {isAddingStock ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" /> Adding...
                    </>
                  ) : (
                    "Confirm & Add to Stock"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
