import * as React from "react";
import {
  Search,
  MapPin,
  Briefcase,
  Star,
  RotateCcw,
  Calendar,
  SlidersHorizontal,
  Stethoscope,
  ChevronLeft,
  ChevronRight,
  Languages,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";
import { BookingModal, type PublicDoctorSummary } from "@/features/appointments/components/BookingModal";

export interface DoctorSearchResponse {
  success: boolean;
  data: PublicDoctorSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    sort: string;
    order: string;
  };
}

const COMMON_SPECIALIZATIONS = [
  "General Physician",
  "Cardiologist",
  "Dermatologist",
  "Pediatrician",
  "Neurologist",
  "Orthopedic",
  "Psychiatrist",
  "Gynecologist",
  "ENT Specialist",
];

export function DoctorSearchPage() {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [specialization, setSpecialization] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [minExperience, setMinExperience] = React.useState<number | "">("");
  const [maxFee, setMaxFee] = React.useState<number | "">("");
  const [minRating, setMinRating] = React.useState<number | "">("");
  const [page, setPage] = React.useState(1);

  const [doctors, setDoctors] = React.useState<PublicDoctorSummary[]>([]);
  const [totalPages, setTotalPages] = React.useState(1);
  const [totalDoctors, setTotalDoctors] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Booking Modal State
  const [selectedDoctorForBooking, setSelectedDoctorForBooking] = React.useState<PublicDoctorSummary | null>(null);
  const [isBookingModalOpen, setIsBookingModalOpen] = React.useState(false);

  // Debounced search trigger
  const [debouncedSearch, setDebouncedSearch] = React.useState(searchTerm);
  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1); // reset to page 1 on new search
    }, 350);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const fetchDoctors = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);

    const queryParams: Record<string, any> = {
      page,
      limit: 12,
      sort: "rating",
      order: "desc",
    };

    if (debouncedSearch.trim()) queryParams.search = debouncedSearch.trim();
    if (specialization.trim()) queryParams.specialization = specialization.trim();
    if (location.trim()) queryParams.location = location.trim();
    if (minExperience !== "") queryParams.minExperience = minExperience;
    if (maxFee !== "") queryParams.maxFee = maxFee;
    if (minRating !== "") queryParams.minRating = minRating;

    try {
      const res = await api.get<DoctorSearchResponse>("/doctors", {
        params: queryParams,
      });

      setDoctors(res.data || []);
      const total = res.pagination?.total ?? 0;
      setTotalDoctors(total);
      setTotalPages(Math.max(1, Math.ceil(total / (res.pagination?.limit || 12))));
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to retrieve doctor directory.");
      } else {
        setErrorMsg("Unable to reach the doctor directory server.");
      }
      setDoctors([]);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, specialization, location, minExperience, maxFee, minRating, page]);

  React.useEffect(() => {
    fetchDoctors();
  }, [fetchDoctors]);

  const handleResetFilters = () => {
    setSearchTerm("");
    setSpecialization("");
    setLocation("");
    setMinExperience("");
    setMaxFee("");
    setMinRating("");
    setPage(1);
  };

  const handleOpenBooking = (doc: PublicDoctorSummary) => {
    setSelectedDoctorForBooking(doc);
    setIsBookingModalOpen(true);
  };

  return (
    <div className="space-y-6" data-testid="doctor-search-page">
      {/* HEADER HERO */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-background to-blue-500/5 border border-border p-6 sm:p-8">
        <div className="max-w-2xl space-y-2">
          <Badge variant="outline" className="text-primary border-primary/30 font-semibold uppercase text-xs">
            Verified Specialist Directory
          </Badge>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Find and Consult Qualified Doctors
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Search verified healthcare clinicians, review specialized credentials, check real-time availability, and schedule telemedicine appointments.
          </p>
        </div>
      </div>

      {/* SEARCH AND FILTERS TOOLBAR */}
      <Card className="border border-border shadow-xs">
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Doctor name or clinic..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="doctor-search-input"
              />
            </div>

            {/* Specialization Filter */}
            <div>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={specialization}
                onChange={(e) => {
                  setSpecialization(e.target.value);
                  setPage(1);
                }}
                data-testid="specialization-filter"
              >
                <option value="">All Specializations</option>
                {COMMON_SPECIALIZATIONS.map((spec) => (
                  <option key={spec} value={spec}>
                    {spec}
                  </option>
                ))}
              </select>
            </div>

            {/* Location Filter */}
            <div className="relative">
              <MapPin className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="City or state..."
                className="pl-9"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setPage(1);
                }}
                data-testid="location-filter"
              />
            </div>
          </div>

          {/* SECONDARY FILTER CONTROLS */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/60 text-xs">
            <span className="text-muted-foreground font-medium flex items-center gap-1">
              <SlidersHorizontal className="size-3.5" /> Filter by:
            </span>

            {/* Min Experience */}
            <select
              className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={minExperience}
              onChange={(e) => {
                setMinExperience(e.target.value === "" ? "" : Number(e.target.value));
                setPage(1);
              }}
              data-testid="experience-filter"
            >
              <option value="">Min Experience</option>
              <option value="3">3+ Years</option>
              <option value="5">5+ Years</option>
              <option value="10">10+ Years</option>
            </select>

            {/* Max Fee */}
            <select
              className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={maxFee}
              onChange={(e) => {
                setMaxFee(e.target.value === "" ? "" : Number(e.target.value));
                setPage(1);
              }}
              data-testid="fee-filter"
            >
              <option value="">Max Fee (₹)</option>
              <option value="500">Under ₹500</option>
              <option value="1000">Under ₹1,000</option>
              <option value="2000">Under ₹2,000</option>
            </select>

            {/* Min Rating */}
            <select
              className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={minRating}
              onChange={(e) => {
                setMinRating(e.target.value === "" ? "" : Number(e.target.value));
                setPage(1);
              }}
              data-testid="rating-filter"
            >
              <option value="">Min Rating</option>
              <option value="4">4.0+ Stars</option>
              <option value="4.5">4.5+ Stars</option>
            </select>

            {/* Reset Button */}
            {(searchTerm || specialization || location || minExperience !== "" || maxFee !== "" || minRating !== "") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground ml-auto"
                onClick={handleResetFilters}
                data-testid="reset-filters-button"
              >
                <RotateCcw className="size-3 mr-1" /> Reset Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* RESULTS HEADER */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing {doctors.length} of {totalDoctors} verified doctors
        </span>
        {specialization && (
          <span className="font-medium text-foreground">
            Category: {specialization}
          </span>
        )}
      </div>

      {/* ERROR STATE */}
      {errorMsg && (
        <ErrorAlert
          title="Doctor Discovery Error"
          message={errorMsg}
          onRetry={fetchDoctors}
          data-testid="doctor-search-error"
        />
      )}

      {/* LOADING SKELETONS */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="doctor-loading-grid">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <Card key={idx} className="border-border">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
                  </div>
                </div>
                <div className="h-3 w-full bg-muted/60 animate-pulse rounded" />
                <div className="h-3 w-2/3 bg-muted/60 animate-pulse rounded" />
                <div className="h-9 w-full bg-muted animate-pulse rounded-lg mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* EMPTY STATE */}
      {!isLoading && !errorMsg && doctors.length === 0 && (
        <EmptyState
          title="No Verified Doctors Found"
          description="No doctors matched your current search filters. Try clearing specializations, location, or fee ranges."
          icon={Stethoscope}
          actionLabel="Clear All Filters"
          onAction={handleResetFilters}
          data-testid="doctor-empty-state"
        />
      )}

      {/* DOCTOR CARDS GRID */}
      {!isLoading && !errorMsg && doctors.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="doctor-results-grid">
          {doctors.map((doc) => (
            <Card key={doc.id} className="border-border hover:border-border/80 transition-shadow hover:shadow-md flex flex-col">
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="size-12 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-base shrink-0">
                      {doc.name.replace(/^Dr\.\s*/i, "").charAt(0)}
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold text-foreground">
                        Dr. {doc.name.replace(/^Dr\.\s*/i, "")}
                      </CardTitle>
                      <CardDescription className="text-xs text-primary font-medium">
                        {doc.specialization}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="doctor" className="shrink-0 text-[10px] uppercase font-bold tracking-wider">
                    Verified
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 space-y-3 flex-1 text-xs">
                {/* Credentials & Details */}
                <div className="space-y-1.5 text-muted-foreground pt-2">
                  <div className="flex items-center gap-1.5">
                    <Briefcase className="size-3.5 shrink-0 text-muted-foreground/70" />
                    <span>{doc.experienceYears} Years Clinical Experience</span>
                  </div>

                  {doc.clinicAddress?.city && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0 text-muted-foreground/70" />
                      <span>
                        {doc.clinicName ? `${doc.clinicName}, ` : ""}
                        {doc.clinicAddress.city}, {doc.clinicAddress.state}
                      </span>
                    </div>
                  )}

                  {doc.languages && doc.languages.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Languages className="size-3.5 shrink-0 text-muted-foreground/70" />
                      <span>{doc.languages.join(", ")}</span>
                    </div>
                  )}
                </div>

                {/* Rating & Fee */}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                    <Star className="size-3.5 fill-current" />
                    <span>{doc.rating > 0 ? doc.rating.toFixed(1) : "New"}</span>
                    {doc.totalReviews > 0 && (
                      <span className="text-muted-foreground text-[11px] font-normal">
                        ({doc.totalReviews})
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-muted-foreground block">Consultation Fee</span>
                    <span className="text-sm font-bold text-foreground">
                      ₹{doc.consultationFee}
                    </span>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="p-5 pt-0">
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => handleOpenBooking(doc)}
                  data-testid={`book-doctor-${doc.id}`}
                >
                  <Calendar className="size-3.5 mr-1.5" /> Book Appointment
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* PAGINATION CONTROLS */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            <ChevronLeft className="size-4 mr-1" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground px-2">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      )}

      {/* GUIDED BOOKING MODAL */}
      <BookingModal
        doctor={selectedDoctorForBooking}
        isOpen={isBookingModalOpen}
        onClose={() => {
          setIsBookingModalOpen(false);
          setSelectedDoctorForBooking(null);
        }}
      />
    </div>
  );
}
