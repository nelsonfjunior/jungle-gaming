import Decimal from "decimal.js";
import { CurrencyMismatchError, InvalidMoneyError } from "../errors/domain.error";

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private static readonly DECIMAL_STRING_REGEX = /^\d+(\.\d{1,2})?$/;
  private static readonly CURRENCY_REGEX = /^[A-Z]{3}$/;

  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  public static from(props: MoneyProps): Money {
    if (!props) {
      throw new InvalidMoneyError("Props cannot be null or undefined");
    }

    const { amount, currency } = props;

    if (typeof currency !== "string" || !this.CURRENCY_REGEX.test(currency)) {
      throw new InvalidMoneyError(
        `Invalid currency code: '${currency}'. Expected 3 uppercase letters (ISO-4217).`,
      );
    }

    if (typeof amount !== "string" || amount.trim() === "") {
      throw new InvalidMoneyError("Amount must be a non-empty string");
    }

    const trimmed = amount.trim();

    // Rejeita notação científica, NaN, Infinity, negativos ou mais de 2 casas decimais
    if (!this.DECIMAL_STRING_REGEX.test(trimmed)) {
      throw new InvalidMoneyError(
        `Invalid amount format: '${amount}'. Amount must be a positive decimal string with at most 2 decimal places.`,
      );
    }

    const decimal = new Decimal(trimmed);
    if (!decimal.isFinite() || decimal.isNaN()) {
      throw new InvalidMoneyError(`Amount is not a valid finite number: '${amount}'`);
    }

    return new Money(decimal, currency);
  }

  public static zero(currency: string): Money {
    if (typeof currency !== "string" || !this.CURRENCY_REGEX.test(currency)) {
      throw new InvalidMoneyError(
        `Invalid currency code: '${currency}'. Expected 3 uppercase letters (ISO-4217).`,
      );
    }
    return new Money(new Decimal(0), currency);
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  public negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  public isNegative(): boolean {
    return this.value.isNegative();
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  public isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  public equals(other: Money): boolean {
    if (this.currency !== other.currency) {
      return false;
    }
    return this.value.equals(other.value);
  }

  public toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  public toString(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

