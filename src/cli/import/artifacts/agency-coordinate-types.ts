export type AgencyCoordinateRequest = {
  rowId: string;
  sourceName?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
};

export type AgencyCoordinateResolution = {
  rowId: string;
  latitude: number;
  longitude: number;
};
