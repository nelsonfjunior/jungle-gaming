import { describe, expect, it } from "bun:test";
import { CurrencyMismatchError, InvalidMoneyError } from "../errors/domain.error";
import { Money } from "./money";

describe("Money Value Object", () => {
  describe("Creation and Validation", () => {
    it("should create a valid Money instance with 2 decimal places", () => {
      const money = Money.from({ amount: "25.00", currency: "BRL" });
      expect(money.toString()).toBe("25.00");
      expect(money.currency).toBe("BRL");
      expect(money.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
    });

    it("should format single decimal digit to 2 decimal places", () => {
      const money = Money.from({ amount: "25.5", currency: "BRL" });
      expect(money.toString()).toBe("25.50");
    });

    it("should format integer string to 2 decimal places", () => {
      const money = Money.from({ amount: "100", currency: "BRL" });
      expect(money.toString()).toBe("100.00");
    });

    it("should create zero Money", () => {
      const zero = Money.zero("BRL");
      expect(zero.toString()).toBe("0.00");
      expect(zero.currency).toBe("BRL");
      expect(zero.isZero()).toBe(true);
    });

    it("should reject more than 2 decimal places", () => {
      expect(() => Money.from({ amount: "25.555", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("should reject negative amount in input contracts", () => {
      expect(() => Money.from({ amount: "-10.00", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("should reject scientific notation", () => {
      expect(() => Money.from({ amount: "1e5", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("should reject non-numeric string, NaN and Infinity", () => {
      expect(() => Money.from({ amount: "NaN", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "Infinity", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "abc", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("should reject invalid currency codes", () => {
      expect(() => Money.from({ amount: "10.00", currency: "brl" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "10.00", currency: "BR" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "10.00", currency: "REAL" })).toThrow(
        InvalidMoneyError,
      );
    });
  });

  describe("Arithmetic & Immutability", () => {
    it("should add two Money instances without mutating the original", () => {
      const m1 = Money.from({ amount: "10.50", currency: "BRL" });
      const m2 = Money.from({ amount: "5.25", currency: "BRL" });
      const sum = m1.add(m2);

      expect(sum.toString()).toBe("15.75");
      expect(m1.toString()).toBe("10.50"); // Imutabilidade preservada
      expect(m2.toString()).toBe("5.25");
    });

    it("should subtract two Money instances without mutating the original", () => {
      const m1 = Money.from({ amount: "20.00", currency: "BRL" });
      const m2 = Money.from({ amount: "5.50", currency: "BRL" });
      const diff = m1.subtract(m2);

      expect(diff.toString()).toBe("14.50");
      expect(m1.toString()).toBe("20.00");
    });

    it("should negate a Money instance", () => {
      const m = Money.from({ amount: "10.00", currency: "BRL" });
      const negated = m.negate();
      expect(negated.toString()).toBe("-10.00");
      expect(negated.isNegative()).toBe(true);
    });

    it("should throw CurrencyMismatchError on operations between different currencies", () => {
      const brl = Money.from({ amount: "10.00", currency: "BRL" });
      const usd = Money.from({ amount: "10.00", currency: "USD" });

      expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
    });
  });

  describe("Comparisons", () => {
    it("should compare lessThan correctly", () => {
      const small = Money.from({ amount: "10.00", currency: "BRL" });
      const large = Money.from({ amount: "20.00", currency: "BRL" });

      expect(small.isLessThan(large)).toBe(true);
      expect(large.isLessThan(small)).toBe(false);
      expect(small.isLessThan(small)).toBe(false);
    });

    it("should check equals correctly", () => {
      const m1 = Money.from({ amount: "15.00", currency: "BRL" });
      const m2 = Money.from({ amount: "15.00", currency: "BRL" });
      const m3 = Money.from({ amount: "15.01", currency: "BRL" });
      const mUsd = Money.from({ amount: "15.00", currency: "USD" });

      expect(m1.equals(m2)).toBe(true);
      expect(m1.equals(m3)).toBe(false);
      expect(m1.equals(mUsd)).toBe(false);
    });

    it("should correctly check positive, negative, and zero", () => {
      const pos = Money.from({ amount: "5.00", currency: "BRL" });
      const zero = Money.zero("BRL");
      const neg = pos.negate();

      expect(pos.isPositive()).toBe(true);
      expect(pos.isZero()).toBe(false);
      expect(pos.isNegative()).toBe(false);

      expect(zero.isZero()).toBe(true);
      expect(zero.isPositive()).toBe(false);
      expect(zero.isNegative()).toBe(false);

      expect(neg.isNegative()).toBe(true);
      expect(neg.isPositive()).toBe(false);
      expect(neg.isZero()).toBe(false);
    });
  });
});

