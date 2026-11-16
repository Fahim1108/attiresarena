"use client";

import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DemoNotice } from "@/components/ui/DemoNotice";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { areasOf, districtsOf, divisionNames } from "@/data/bangladesh";
import { isValidBdPhone, type FieldErrors } from "@/lib/validation";
import { deleteAddressAction, saveAddressAction } from "@/services/actions";
import type { Address } from "@/types";

const empty: Address = { id: "", label: "Home", fullName: "", phone: "", division: "", district: "", area: "", addressLine: "", isDefault: false };

/** Address book. Every change round-trips to the server; the list only changes when the server confirms it. */
export function AddressManager({ initial }: { initial: Address[] }) {
  const [addresses, setAddresses] = useState(initial);
  const [editing, setEditing] = useState<Address | null>(null);
  const [errors, setErrors] = useState<FieldErrors<keyof Address>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const districts = useMemo(() => districtsOf(editing?.division ?? ""), [editing?.division]);
  const areas = useMemo(() => areasOf(editing?.district ?? ""), [editing?.district]);
  const focusFirstError = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

  const save = async () => {
    if (!editing || saving) return;
    const e: typeof errors = {};
    if (editing.fullName.trim().length < 3) e.fullName = "Required";
    if (!isValidBdPhone(editing.phone)) e.phone = "Enter a valid mobile number";
    if (!editing.division) e.division = "Required";
    if (!editing.district) e.district = "Required";
    if (!editing.area.trim()) e.area = "Required";
    if (editing.addressLine.trim().length < 6) e.addressLine = "Enter full address";
    setErrors(e);
    if (e.fullName) return focusFirstError("addr-fullName");
    if (e.phone) return focusFirstError("addr-phone");
    if (e.division) return focusFirstError("addr-division");
    if (e.district) return focusFirstError("addr-district");
    if (e.area) return focusFirstError("addr-area");
    if (e.addressLine) return focusFirstError("addr-addressLine");
    setSaving(true);
    try {
      const r = await saveAddressAction(editing);
      if (!r.ok) {
        setNotice(r.message);
        return;
      }
      const saved = r.data;
      setAddresses((list) => {
        const next = list.some((a) => a.id === saved.id) ? list.map((a) => (a.id === saved.id ? saved : a)) : [...list, saved];
        return saved.isDefault ? next.map((a) => ({ ...a, isDefault: a.id === saved.id })) : next;
      });
      setNotice(null);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const r = await deleteAddressAction(id);
      if (r.ok) {
        setAddresses((list) => list.filter((a) => a.id !== id));
        setNotice(null);
      } else {
        setNotice(r.message);
      }
    } finally {
      setBusyId(null);
    }
  };

  const makeDefault = async (address: Address) => {
    if (busyId) return;
    setBusyId(address.id);
    try {
      const r = await saveAddressAction({ ...address, isDefault: true });
      if (r.ok) {
        const saved = r.data;
        setAddresses((list) => list.map((a) => (a.id === saved.id ? saved : { ...a, isDefault: false })));
        setNotice(null);
      } else {
        setNotice(r.message);
      }
    } finally {
      setBusyId(null);
    }
  };

  const upd = (patch: Partial<Address>) => setEditing((a) => (a ? { ...a, ...patch } : a));

  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-serif text-3xl text-ink">Saved Addresses</h2>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setErrors({}); setConfirmDeleteId(null); setEditing({ ...empty }); }}>
          Add Address
        </Button>
      </div>
      {notice && <DemoNotice force className="mb-4">{notice}</DemoNotice>}
      {addresses.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="flex flex-col rounded-card border border-line p-5">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" aria-hidden />
                <span className="font-medium text-ink">{a.label}</span>
                {a.isDefault && <Badge tone="soft">Default</Badge>}
              </div>
              <p className="mt-3 break-words text-sm leading-relaxed text-ink-muted">
                {a.fullName} · {a.phone}
                <br />
                {a.addressLine}, {a.area}, {a.district}, {a.division}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <Button variant="ghost" aria-label={`Edit ${a.label} address`} leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setErrors({}); setConfirmDeleteId(null); setEditing(a); }}>
                  Edit
                </Button>
                {!a.isDefault && (
                  <Button variant="ghost" aria-label={`Set ${a.label} as the default address`} leftIcon={<Star className="h-3.5 w-3.5" />} disabled={busyId !== null} onClick={() => void makeDefault(a)}>
                    Set default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="text-danger"
                  aria-label={confirmDeleteId === a.id ? `Confirm delete ${a.label} address` : `Delete ${a.label} address`}
                  leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                  disabled={busyId !== null}
                  onClick={() => {
                    if (confirmDeleteId === a.id) {
                      setConfirmDeleteId(null);
                      void remove(a.id);
                    } else {
                      setConfirmDeleteId(a.id);
                    }
                  }}
                >
                  {confirmDeleteId === a.id ? "Confirm delete" : "Delete"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<MapPin className="h-7 w-7" />} title="No saved addresses" description="Add an address for faster checkout." />
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit Address" : "New Address"}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>Save Address</Button>
          </div>
        }
      >
        {editing && (
          <>
            {notice && <DemoNotice force className="mb-4">{notice}</DemoNotice>}
            <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Label" name="address-label" options={["Home", "Office", "Other"].map((v) => ({ value: v, label: v }))} value={editing.label} onChange={(e) => upd({ label: e.target.value })} />
            <Input id="addr-fullName" name="name" label="Full Name" autoComplete="name" value={editing.fullName} onChange={(e) => upd({ fullName: e.target.value })} error={errors.fullName} />
            <Input id="addr-phone" name="tel" label="Mobile Number" type="tel" autoComplete="tel" placeholder="01XXXXXXXXX" value={editing.phone} onChange={(e) => upd({ phone: e.target.value })} error={errors.phone} wrapperClassName="sm:col-span-2" />
            <Select id="addr-division" name="division" label="Division" placeholder="Select division" options={divisionNames.map((d) => ({ value: d, label: d }))} value={editing.division} onChange={(e) => upd({ division: e.target.value, district: "", area: "" })} error={errors.division} />
            <Select id="addr-district" name="district" label="District" placeholder="Select district" disabled={!editing.division} options={districts.map((d) => ({ value: d, label: d }))} value={editing.district} onChange={(e) => upd({ district: e.target.value, area: "" })} error={errors.district} />
            {areas.length ? (
              <Select id="addr-area" name="area" label="Area / Thana" placeholder="Select area" options={areas.map((d) => ({ value: d, label: d }))} value={editing.area} onChange={(e) => upd({ area: e.target.value })} error={errors.area} wrapperClassName="sm:col-span-2" />
            ) : (
              <Input id="addr-area" name="area" label="Area / Upazila" value={editing.area} disabled={!editing.district} onChange={(e) => upd({ area: e.target.value })} error={errors.area} wrapperClassName="sm:col-span-2" />
            )}
            <Textarea id="addr-addressLine" name="address" label="Detailed Address" autoComplete="street-address" value={editing.addressLine} onChange={(e) => upd({ addressLine: e.target.value })} error={errors.addressLine} wrapperClassName="sm:col-span-2" className="min-h-[80px]" />
            <Checkbox name="default-address" label="Set as default address" checked={editing.isDefault} onChange={(e) => upd({ isDefault: e.target.checked })} className="sm:col-span-2" />
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
